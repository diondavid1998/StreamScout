import SwiftUI
import Charts
import UniformTypeIdentifiers

// MARK: - Reading an export off disk

/// Pulling the CSVs out of whatever the file picker handed back.
///
/// Letterboxd gives you a zip. iOS Files can uncompress it in place, which
/// leaves a folder — so the picker accepts a folder and reads every CSV inside
/// it, and also accepts loose CSVs for anyone who unpacked them by hand. One
/// button either way.
enum LetterboxdExport {
    struct File: Sendable {
        let name: String
        let text: String
    }

    enum ReadError: LocalizedError {
        case zipNotSupported
        case noCsvFound
        case unreadable(String)

        var errorDescription: String? {
            switch self {
            case .zipNotSupported:
                return "That's still a zip. Tap and hold it in Files, choose Uncompress, then pick the folder it makes."
            case .noCsvFound:
                return "No CSV files in there. Pick the folder from your Letterboxd export."
            case .unreadable(let name):
                return "Could not read \(name)."
            }
        }
    }

    /// Read every CSV the user picked, following one level into a folder.
    static func read(urls: [URL]) throws -> [File] {
        var files: [File] = []

        for url in urls {
            // A picked file lives outside the app's sandbox; without this the
            // read fails with a permission error that looks like a missing file.
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }

            if url.pathExtension.lowercased() == "zip" { throw ReadError.zipNotSupported }

            var isDirectory: ObjCBool = false
            FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory)

            if isDirectory.boolValue {
                let contents = (try? FileManager.default.contentsOfDirectory(
                    at: url, includingPropertiesForKeys: nil, options: [.skipsHiddenFiles]
                )) ?? []
                for child in contents where child.pathExtension.lowercased() == "csv" {
                    files.append(try readOne(child))
                }
            } else if url.pathExtension.lowercased() == "csv" {
                files.append(try readOne(url))
            }
        }

        if files.isEmpty { throw ReadError.noCsvFound }

        // reviews.csv is not optional, whatever its size.
        //
        // An earlier version of this dropped it, on the reasoning that every
        // viewing it holds is also in diary.csv. That is only true when there
        // *is* a diary.csv — and a real export can arrive without one, in which
        // case reviews.csv is the only file carrying a Watched Date, a Rewatch
        // flag or tags at all. On a 1,782-film export with no diary, dropping
        // it took dated viewings from 47 to 0 and switched the whole habits
        // section off.
        //
        // profile.csv stays out for a different reason: nothing reads it, and
        // it is the one file in the export that carries an email address.
        // Comments, likes and lists are simply unread.
        let wanted = ["diary", "ratings", "watched", "watchlist", "reviews"]
        let useful = files.filter { file in
            wanted.contains { file.name.lowercased().contains($0) }
        }
        // Unless nothing matched, in which case the files have been renamed and
        // the server's header-based classifier is the better judge.
        return Array((useful.isEmpty ? files : useful).prefix(20))
    }

    private static func readOne(_ url: URL) throws -> File {
        // Letterboxd writes UTF-8, but a file round-tripped through a spreadsheet
        // can come back as Latin-1, and failing the whole import over one file's
        // encoding would be a poor trade.
        let text: String
        if let utf8 = try? String(contentsOf: url, encoding: .utf8) {
            text = utf8
        } else if let latin = try? String(contentsOf: url, encoding: .isoLatin1) {
            text = latin
        } else {
            throw ReadError.unreadable(url.lastPathComponent)
        }
        return File(name: url.lastPathComponent, text: text)
    }
}

// MARK: - Screen

/// The Letterboxd analytics page.
///
/// Built as one lens over one filtered slice rather than a single long scroll.
/// The reader picks a question — who directed these, what language were they in
/// — and only that question is answered; picking an entry inside a lens adds it
/// as a filter, so drilling down and filtering are the same gesture.
///
/// Everything except the people, genre and language lenses is computed from the
/// uploaded CSVs and needs no network, so it renders the moment an import lands.
struct AnalyticsView: View {
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss

    @State private var analytics: AnalyticsResponse?
    @State private var isLoading = true
    @State private var loadError: String?

    /// The lens, and the filters narrowing the history under it. Both go
    /// straight into the query string, so the server stays the only place that
    /// knows how either is computed.
    @State private var dimension = "overview"
    @State private var filters: [String: String] = [:]

    @State private var showFilterSheet = false
    @State private var showImporter = false
    @State private var importStatus: String?
    @State private var importError: String?
    @State private var isImporting = false

    @State private var isResolving = false
    @State private var resolveStatus: String?

    /// Above and below the reader's own average. Fixed mid-tones rather than
    /// `.green`/`.orange`, which sit outside every palette and read differently
    /// on a light ground than a dark one.
    private static let over = Color(hex: "#2E9E6B")
    private static let under = Color(hex: "#C4562F")

    var body: some View {
        NavigationStack {
            ZStack {
                Color.mkBackground.ignoresSafeArea()
                content
            }
            .navigationTitle("Diary Analytics")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Done") { dismiss() }.fontWeight(.semibold).foregroundColor(.mkAccent)
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        showImporter = true
                    } label: {
                        Image(systemName: "square.and.arrow.down")
                    }
                    .foregroundColor(.mkAccent)
                    .disabled(isImporting)
                    .accessibilityLabel("Import Letterboxd export")
                }
            }
        }
        .sheet(isPresented: $showFilterSheet) {
            if let a = analytics {
                FilterSheet(available: a.filters.available, applied: filters) { next in
                    filters = next
                    Task { await load() }
                }
            }
        }
        .fileImporter(
            isPresented: $showImporter,
            // A folder first, because that is what uncompressing the export
            // leaves behind and it is the one-tap path.
            allowedContentTypes: [.folder, .commaSeparatedText, .plainText, .zip],
            allowsMultipleSelection: true
        ) { result in
            switch result {
            case .success(let urls): Task { await importExport(urls: urls) }
            case .failure(let error): importError = error.localizedDescription
            }
        }
        .task { await load() }
    }

    @ViewBuilder
    private var content: some View {
        if isLoading && analytics == nil {
            VStack { Spacer(); ProgressView().tint(.mkAccent); Spacer() }
        } else if let a = analytics, a.summary.films > 0 {
            VStack(spacing: 0) {
                chrome(a)
                Divider().overlay(Color.mkBorder)
                ScrollView {
                    VStack(alignment: .leading, spacing: 22) {
                        if let importStatus { banner(importStatus, tone: .accent) }
                        if let importError { banner(importError, tone: .error) }
                        lensBody(a)
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 16)
                    .padding(.bottom, 28)
                }
                // A lens change replaces the whole view; without this the scroll
                // position carries over and the new lens opens half-way down.
                .id(a.dimension)
            }
        } else {
            emptyState
        }
    }

    // MARK: Chrome — scope, filters, lenses

    private func chrome(_ a: AnalyticsResponse) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(scopeLine(a))
                    .font(.footnote)
                    .foregroundColor(.mkMuted)
                Spacer()
                Button {
                    showFilterSheet = true
                } label: {
                    HStack(spacing: 5) {
                        Image(systemName: "line.3.horizontal.decrease")
                        Text(filters.isEmpty ? "Filter" : "Filters")
                        if !filters.isEmpty {
                            Text("\(filters.count)")
                                .font(.caption2.weight(.bold))
                                .padding(.horizontal, 5).padding(.vertical, 1)
                                .background(Color.mkOnAccent.opacity(0.9), in: Capsule())
                                .foregroundColor(.mkAccent)
                        }
                    }
                    .font(.footnote.weight(.semibold))
                    .foregroundColor(filters.isEmpty ? .mkText : .mkOnAccent)
                    .padding(.horizontal, 11).padding(.vertical, 6)
                    .background(filters.isEmpty ? Color.mkSubtleFill : Color.mkAccent, in: Capsule())
                }
                .buttonStyle(.plain)
            }

            if !a.filters.applied.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(a.filters.applied) { chip in
                            Button {
                                filters.removeValue(forKey: chip.key)
                                Task { await load() }
                            } label: {
                                HStack(spacing: 4) {
                                    Text(chip.label)
                                    Image(systemName: "xmark").font(.system(size: 8, weight: .bold))
                                }
                                .font(.caption.weight(.semibold))
                                .foregroundColor(.mkAccent)
                                .padding(.horizontal, 9).padding(.vertical, 5)
                                .background(Color.mkAccent.opacity(0.14), in: Capsule())
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Remove filter \(chip.label)")
                        }
                        Button("Clear all") {
                            filters = [:]
                            Task { await load() }
                        }
                        .font(.caption.weight(.semibold))
                        .foregroundColor(.mkMuted)
                        .buttonStyle(.plain)
                    }
                }
                .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
            }

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(a.dimensions) { lens in
                        Button {
                            guard dimension != lens.id else { return }
                            dimension = lens.id
                            Task { await load() }
                        } label: {
                            Text(lens.title)
                                .font(.subheadline.weight(dimension == lens.id ? .bold : .medium))
                                .foregroundColor(dimension == lens.id ? .mkOnAccent : .mkText.opacity(0.8))
                                .padding(.horizontal, 13).padding(.vertical, 7)
                                .background(
                                    dimension == lens.id ? Color.mkAccent : Color.mkSubtleFill,
                                    in: Capsule()
                                )
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(dimension == lens.id ? [.isSelected] : [])
                    }
                }
            }
            .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 10)
    }

    private func scopeLine(_ a: AnalyticsResponse) -> String {
        let films = a.scope.films
        if !a.scope.filtered { return "\(films) film\(films == 1 ? "" : "s")" }
        return "\(films) of \(a.scope.filmsTotal) films"
    }

    // MARK: Lens bodies

    @ViewBuilder
    private func lensBody(_ a: AnalyticsResponse) -> some View {
        if a.scope.films == 0 {
            noMatches
        } else {
            switch a.dimension {
            case "overview":
                summaryTiles(a)
                if let rating = a.rating { ratingChart(rating) }
                if let highlights = a.highlights { highlightCards(highlights) }
            case "ratings":
                summaryTiles(a)
                if let rating = a.rating { ratingDetail(rating) }
            case "decades":
                if let eras = a.eras { erasDetail(eras) }
                if let b = a.breakdown { breakdownList(b, a) }
            default:
                if let b = a.breakdown {
                    if b.needsLookup && a.coverage.pending > 0 { lookupPrompt(a) }
                    breakdownList(b, a)
                    if !b.best.isEmpty { deltaEnds(b) }
                } else if let collection = a.collection {
                    tagList(collection)
                }
            }
        }
    }

    private var noMatches: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Nothing matches these filters")
                .font(.headline).foregroundColor(.mkText)
            Text("Remove one above, or clear them all.")
                .font(.subheadline).foregroundColor(.mkMuted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Color.mkSurface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    // MARK: Summary

    private func summaryTiles(_ a: AnalyticsResponse) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 148), spacing: 10)], spacing: 10) {
            tile("Films", "\(a.summary.films)", detail: a.scope.filtered ? "of \(a.scope.filmsTotal)" : nil)
            tile("Time in the dark", hours(a.summary.runtimeMinutes),
                 detail: a.coverage.resolved < a.coverage.films ? "of \(a.coverage.resolved) resolved" : nil)
            tile("Your mean", a.summary.meanRating.map { String(format: "%.2f", $0) } ?? "—",
                 detail: "\(a.summary.rated) rated")
            tile("Versus the crowd", offsetLabel(a.summary.tasteOffset),
                 detail: (a.summary.comparedOn ?? 0) > 0 ? "over \(a.summary.comparedOn ?? 0) films" : "not compared yet")
        }
    }

    private func tile(_ label: String, _ value: String, detail: String?) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label.uppercased())
                .font(.caption2.weight(.bold)).tracking(0.7)
                .foregroundColor(.mkMuted)
            Text(value)
                .font(.system(.title2, design: .rounded, weight: .bold))
                .foregroundColor(.mkText)
                .minimumScaleFactor(0.6).lineLimit(1)
            if let detail {
                Text(detail).font(.caption2).foregroundColor(.mkMuted).lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(13)
        .background(Color.mkSurface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    // MARK: Ratings

    private func ratingChart(_ rating: AnalyticsRating) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionHeader("How you rate")
            Chart(rating.histogram) { bucket in
                BarMark(x: .value("Rating", bucket.rating), y: .value("Films", bucket.films), width: .fixed(16))
                    .foregroundStyle(
                        // The mode carries the accent; the rest stay quiet, so
                        // the shape of the distribution reads before the numbers.
                        // Quiet bars are keyed off the text colour rather than a
                        // faint muted grey, so they stay legible on every theme.
                        bucket.rating == rating.mode?.rating ? Color.mkAccent : Color.mkText.opacity(0.26)
                    )
                    .cornerRadius(3)
            }
            .chartXScale(domain: 0.25...5.25)
            // Whole stars only: ten half-star labels collide at phone width.
            .chartXAxis { AxisMarks(values: .stride(by: 1.0)) }
            .chartYAxis { AxisMarks(position: .leading) { _ in
                AxisGridLine().foregroundStyle(Color.mkHairline)
                AxisValueLabel()
            } }
            .frame(height: 150)
            if let mode = rating.mode, mode.films > 0 {
                caption("Most common: \(stars(mode.rating)) — \(mode.films) films")
            }
        }
    }

    @ViewBuilder
    private func ratingDetail(_ rating: AnalyticsRating) -> some View {
        ratingChart(rating)
        if !rating.byYear.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                sectionHeader("Mean by year watched")
                Chart(rating.byYear) { year in
                    LineMark(x: .value("Year", year.year), y: .value("Mean", year.meanRating ?? 0))
                        .foregroundStyle(Color.mkAccent)
                        .lineStyle(StrokeStyle(lineWidth: 2))
                    PointMark(x: .value("Year", year.year), y: .value("Mean", year.meanRating ?? 0))
                        .foregroundStyle(Color.mkAccent)
                        .symbolSize(56)
                }
                .chartYScale(domain: 0.0...5.0)
                .frame(height: 140)
            }
        }
        if !rating.hottestTakes.above.isEmpty || !rating.hottestTakes.below.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                sectionHeader("Where you disagree most")
                VStack(spacing: 0) {
                    ForEach(rating.hottestTakes.above.prefix(4)) { takeRow($0, positive: true) }
                    ForEach(rating.hottestTakes.below.prefix(4)) { takeRow($0, positive: false) }
                }
                .padding(.horizontal, 13).padding(.vertical, 4)
                .background(Color.mkSurface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
        }
    }

    private func takeRow(_ film: TitleDelta, positive: Bool) -> some View {
        HStack(spacing: 8) {
            // Direction is carried by the arrow and the sign as well as colour,
            // so the row still reads without it.
            Image(systemName: positive ? "arrow.up" : "arrow.down")
                .font(.caption2.weight(.bold))
                .foregroundColor(positive ? Self.over : Self.under)
            Text(film.name).font(.subheadline).foregroundColor(.mkText).lineLimit(1)
            Spacer(minLength: 8)
            Text(String(format: "%+.1f", film.delta))
                .font(.subheadline.weight(.semibold).monospacedDigit())
                .foregroundColor(positive ? Self.over : Self.under)
        }
        .padding(.vertical, 8)
    }

    // MARK: Decades

    @ViewBuilder
    private func erasDetail(_ eras: AnalyticsEras) -> some View {
        if !eras.decades.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                sectionHeader("Films by decade")
                // The busiest decade carries the accent, matching the rating
                // histogram; the rest stay quiet so the peak reads at a glance.
                let peakFilms = eras.decades.map(\.films).max() ?? 0
                Chart(eras.decades) { decade in
                    BarMark(x: .value("Decade", decade.decade), y: .value("Films", decade.films), width: .fixed(20))
                        .foregroundStyle(decade.films == peakFilms ? Color.mkAccent : Color.mkText.opacity(0.26))
                        .cornerRadius(3)
                }
                // Categorical X: labels only, no gridline noise between decades.
                .chartXAxis { AxisMarks { _ in AxisValueLabel() } }
                .chartYAxis { AxisMarks(position: .leading) { _ in
                    AxisGridLine().foregroundStyle(Color.mkHairline)
                    AxisValueLabel()
                } }
                .frame(height: 150)
            }
        }
        if let lag = eras.lagYearsMedian {
            caption("You typically watch a film \(String(format: "%.0f", lag)) years after it comes out.")
        }
    }

    // MARK: The focused dimension

    private func breakdownList(_ b: AnalyticsBreakdown, _ a: AnalyticsResponse) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionHeader(
                b.title,
                note: b.total > b.entries.count ? "top \(b.entries.count) of \(b.total)" : nil
            )
            if b.entries.isEmpty {
                Text(b.needsLookup
                     ? "Nothing here yet — these come from the film database, not the export."
                     : "Nothing to show for this slice.")
                    .font(.subheadline).foregroundColor(.mkMuted)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(b.entries.enumerated()), id: \.element.id) { index, entry in
                        entryRow(entry, filterKey: b.filterKey, showsDivider: index < b.entries.count - 1)
                    }
                }
                .background(Color.mkSurface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
        }
    }

    /// One ranked entry. Tapping it narrows the whole page to that subject,
    /// which is the same thing as adding a filter — so it does exactly that.
    private func entryRow(_ entry: BreakdownEntry, filterKey: String?, showsDivider: Bool) -> some View {
        Button {
            guard let key = filterKey else { return }
            filters[key] = entry.name
            Task { await load() }
        } label: {
            VStack(spacing: 0) {
                HStack(spacing: 10) {
                    Text(entry.label)
                        .font(.subheadline)
                        .foregroundColor(.mkText)
                        .lineLimit(1)
                    Spacer(minLength: 8)
                    Text("\(entry.films)")
                        .font(.subheadline.weight(.semibold).monospacedDigit())
                        .foregroundColor(.mkAccent)
                    if let mean = entry.meanRating {
                        Text(String(format: "%.1f★", mean))
                            .font(.caption.monospacedDigit())
                            .foregroundColor(.mkMuted)
                            .frame(minWidth: 38, alignment: .trailing)
                    }
                    if let delta = entry.delta {
                        Text(String(format: "%+.1f", delta))
                            .font(.caption.weight(.semibold).monospacedDigit())
                            .foregroundColor(delta >= 0 ? Self.over : Self.under)
                            .frame(minWidth: 34, alignment: .trailing)
                    }
                    if filterKey != nil {
                        Image(systemName: "chevron.right")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundColor(.mkMuted.opacity(0.6))
                    }
                }
                .padding(.horizontal, 13)
                .padding(.vertical, 10)
                if showsDivider { Divider().overlay(Color.mkBorder).padding(.leading, 13) }
            }
        }
        .buttonStyle(.plain)
        .disabled(filterKey == nil)
        .accessibilityLabel("\(entry.label), \(entry.films) films")
        .accessibilityHint(filterKey == nil ? "" : "Filters the page to \(entry.label)")
    }

    private func deltaEnds(_ b: AnalyticsBreakdown) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            endList("Rated well above your average", b.best)
            endList("Rated below your average", b.worst)
        }
    }

    @ViewBuilder
    private func endList(_ title: String, _ entries: [BreakdownEntry]) -> some View {
        if !entries.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                sectionHeader(title)
                VStack(spacing: 0) {
                    ForEach(Array(entries.prefix(6).enumerated()), id: \.element.id) { index, entry in
                        HStack(spacing: 10) {
                            Text(entry.label).font(.subheadline).foregroundColor(.mkText).lineLimit(1)
                            Spacer(minLength: 8)
                            Text("\(entry.films) film\(entry.films == 1 ? "" : "s")")
                                .font(.caption).foregroundColor(.mkMuted)
                            Text(String(format: "%+.1f", entry.delta ?? 0))
                                .font(.subheadline.weight(.semibold).monospacedDigit())
                                .foregroundColor((entry.delta ?? 0) >= 0 ? Self.over : Self.under)
                        }
                        .padding(.horizontal, 13).padding(.vertical, 9)
                        if index < min(entries.count, 6) - 1 {
                            Divider().overlay(Color.mkBorder).padding(.leading, 13)
                        }
                    }
                }
                .background(Color.mkSurface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
        }
    }

    @ViewBuilder
    private func tagList(_ collection: AnalyticsCollection) -> some View {
        if collection.topTags.isEmpty {
            Text("No tags in this export.").font(.subheadline).foregroundColor(.mkMuted)
        } else {
            VStack(alignment: .leading, spacing: 8) {
                sectionHeader("Your tags")
                FlowRow(spacing: 6) {
                    ForEach(collection.topTags) { tag in
                        Text("\(tag.tag) · \(tag.films)")
                            .font(.caption.weight(.semibold))
                            .foregroundColor(.mkText)
                            .padding(.horizontal, 10).padding(.vertical, 6)
                            .background(Color.mkSubtleFill, in: Capsule())
                            .overlay(Capsule().stroke(Color.mkHairline, lineWidth: 1))
                    }
                }
            }
        }
    }

    // MARK: Overview highlights

    private func highlightCards(_ highlights: [AnalyticsHighlight]) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            ForEach(highlights) { group in
                if !group.entries.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Button {
                            dimension = group.id
                            Task { await load() }
                        } label: {
                            HStack {
                                Text(group.title)
                                    .font(.headline).foregroundColor(.mkText)
                                Spacer()
                                Text("See all")
                                    .font(.caption.weight(.semibold)).foregroundColor(.mkAccent)
                                Image(systemName: "chevron.right")
                                    .font(.system(size: 10, weight: .bold)).foregroundColor(.mkAccent)
                            }
                        }
                        .buttonStyle(.plain)
                        VStack(spacing: 0) {
                            ForEach(Array(group.entries.enumerated()), id: \.element.id) { index, entry in
                                HStack(spacing: 10) {
                                    Text(entry.label).font(.subheadline).foregroundColor(.mkText).lineLimit(1)
                                    Spacer(minLength: 8)
                                    Text("\(entry.films)")
                                        .font(.subheadline.weight(.semibold).monospacedDigit())
                                        .foregroundColor(.mkAccent)
                                }
                                .padding(.horizontal, 13).padding(.vertical, 9)
                                if index < group.entries.count - 1 {
                                    Divider().overlay(Color.mkBorder).padding(.leading, 13)
                                }
                            }
                        }
                        .background(Color.mkSurface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    }
                }
            }
        }
    }

    // MARK: The lookup

    private func lookupPrompt(_ a: AnalyticsResponse) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("No Letterboxd export contains a director, a cast list or a genre — those come from the film database, and only when you ask.")
                .font(.footnote).foregroundColor(.mkMuted)
                .fixedSize(horizontal: false, vertical: true)
            if let resolveStatus {
                HStack(spacing: 8) {
                    if isResolving { ProgressView().tint(.mkAccent).scaleEffect(0.8) }
                    Text(resolveStatus).font(.footnote).foregroundColor(.mkMuted)
                }
            }
            Button {
                Task { await resolveAll(pending: a.coverage.pending) }
            } label: {
                Text(isResolving ? "Working…" : "Look up \(a.coverage.pending) films")
                    .font(.subheadline.weight(.semibold))
                    .foregroundColor(.mkText)
                    .padding(.horizontal, 16).frame(height: 42)
            }
            .buttonStyle(.plain)
            .glassEffect(.regular.tint(Color.mkAccent).interactive(), in: Capsule())
            .disabled(isResolving)
        }
        .padding(14)
        .background(Color.mkSurface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    // MARK: Empty state

    private var emptyState: some View {
        VStack(spacing: 14) {
            Spacer()
            Image(systemName: "chart.bar.xaxis").font(.system(size: 46)).foregroundColor(.mkMuted)
            Text("No diary yet").font(.title3).bold().foregroundColor(.mkText)
            Text("Download your export from letterboxd.com/settings/data. In Files, tap and hold the zip and choose Uncompress — then pick the folder here.")
                .font(.subheadline).foregroundColor(.mkMuted)
                .multilineTextAlignment(.center).padding(.horizontal, 34)
            if let message = importError ?? loadError {
                Text(message).font(.footnote).foregroundColor(.red)
                    .multilineTextAlignment(.center).padding(.horizontal, 34)
            }
            Button {
                showImporter = true
            } label: {
                HStack(spacing: 8) {
                    if isImporting { ProgressView().tint(.mkText).scaleEffect(0.8) }
                    else { Image(systemName: "folder.badge.plus") }
                    Text(isImporting ? (importStatus ?? "Importing…") : "Import Letterboxd export")
                        .font(.subheadline.weight(.semibold))
                }
                .foregroundColor(.mkText)
                .padding(.horizontal, 20).frame(height: 48)
            }
            .buttonStyle(.plain)
            .glassEffect(.regular.tint(Color.mkAccent).interactive(), in: Capsule())
            .disabled(isImporting)
            .padding(.top, 6)
            Spacer()
        }
    }

    // MARK: Pieces

    private func sectionHeader(_ title: String, note: String? = nil) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title).font(.headline).foregroundColor(.mkText)
            Spacer()
            if let note {
                Text(note).font(.caption).foregroundColor(.mkMuted)
            }
        }
    }

    private func caption(_ text: String) -> some View {
        Text(text).font(.caption).foregroundColor(.mkMuted)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func banner(_ text: String, tone: BannerTone) -> some View {
        Text(text)
            .font(.footnote)
            .foregroundColor(tone == .error ? .red : .mkAccent)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(Color.mkSurface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private enum BannerTone { case accent, error }

    private func hours(_ minutes: Int) -> String {
        guard minutes > 0 else { return "—" }
        let h = minutes / 60
        if h < 1 { return "\(minutes)m" }
        if h < 100 { return "\(h)h" }
        return "\(h.formatted())h"
    }

    private func offsetLabel(_ offset: Double?) -> String {
        guard let offset else { return "—" }
        return String(format: "%+.2f", offset)
    }

    private func stars(_ rating: Double) -> String {
        let full = Int(rating)
        return String(repeating: "★", count: full) + (rating - Double(full) >= 0.5 ? "½" : "")
    }

    // MARK: Networking

    @MainActor private func load() async {
        isLoading = analytics == nil
        do {
            var params = filters
            params["dimension"] = dimension
            let response: AnalyticsResponse = try await APIService.shared.get(
                "/analytics", params: params, token: app.token
            )
            analytics = response
            loadError = nil
        } catch let error as APIError {
            if case .unauthorized = error { app.logout() }
            loadError = error.errorDescription
        } catch {
            loadError = error.localizedDescription
        }
        isLoading = false
    }

    @MainActor private func importExport(urls: [URL]) async {
        importError = nil
        importStatus = "Reading files…"
        isImporting = true
        defer { isImporting = false }

        let files: [LetterboxdExport.File]
        do {
            files = try LetterboxdExport.read(urls: urls)
        } catch {
            importStatus = nil
            importError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            return
        }

        importStatus = "Uploading \(files.count) file\(files.count == 1 ? "" : "s")…"
        do {
            let payload = files.map { ["name": $0.name, "text": $0.text] }
            let response: DiaryImportResponse = try await APIService.shared.post(
                "/letterboxd/diary", body: ["files": payload], token: app.token, timeout: 120
            )
            let films = response.films ?? 0
            let viewings = response.viewings ?? 0
            importStatus = "Imported \(films) films across \(viewings) viewings."
            // A fresh import invalidates whatever was filtered before it.
            filters = [:]
            dimension = "overview"
            await load()
        } catch let error as APIError {
            importStatus = nil
            importError = error.errorDescription
            if case .unauthorized = error { app.logout() }
        } catch {
            importStatus = nil
            importError = error.localizedDescription
        }
    }

    /// Walk the backlog in batches until nothing is pending.
    ///
    /// Batched rather than one long request because a large history is
    /// thousands of films; the loop stops on its own if a batch stops making
    /// progress, so an unresolvable tail cannot spin forever.
    @MainActor private func resolveAll(pending: Int) async {
        isResolving = true
        defer { isResolving = false }
        var remaining = pending
        var rounds = 0
        // A batch that leaves the backlog no shorter than it found it. Films the
        // database has nothing for drop out of `pending` server-side, so a stall
        // means the lookup could not get through — worth trying again later,
        // unlike an unmatched film.
        var stalled = false

        while remaining > 0 && rounds < 200 {
            rounds += 1
            resolveStatus = "\(remaining) films to look up…"
            do {
                let response: ResolveResponse = try await APIService.shared.post(
                    "/analytics/resolve", body: ["limit": 60], token: app.token, timeout: 120
                )
                let next = response.pending ?? 0
                if next >= remaining {
                    remaining = next
                    stalled = true
                    break
                }
                remaining = next
            } catch {
                resolveStatus = "Stopped — \(remaining) still to look up. Try again."
                await load()
                return
            }
        }

        if remaining == 0 {
            resolveStatus = nil
        } else if stalled {
            resolveStatus = "Stopped — \(remaining) could not be looked up just now. Try again."
        } else {
            resolveStatus = "\(remaining) still to look up."
        }
        await load()
    }
}

// MARK: - Filter sheet

/// Every facet in one sheet, each option carrying how many films it would leave.
///
/// The counts come from the server, computed against every filter except the one
/// being picked — so switching language still shows what the alternatives give
/// you, while the genre list narrows to what the current language offers.
private struct FilterSheet: View {
    let available: AvailableFilters
    let applied: [String: String]
    let onApply: ([String: String]) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var draft: [String: String]

    init(available: AvailableFilters, applied: [String: String], onApply: @escaping ([String: String]) -> Void) {
        self.available = available
        self.applied = applied
        self.onApply = onApply
        _draft = State(initialValue: applied)
    }

    private static let facets: [(key: String, title: String)] = [
        ("language", "Language"),
        ("genre", "Genre"),
        ("decade", "Decade"),
        ("director", "Director"),
        ("actor", "Actor"),
        ("tag", "Tag"),
    ]

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Picker("Rating", selection: ratedBinding) {
                        Text("All films").tag("")
                        Text("Rated only").tag("yes")
                        Text("Unrated only").tag("no")
                    }
                    Picker("At least", selection: minBinding) {
                        Text("Any").tag("")
                        ForEach(["1", "2", "3", "3.5", "4", "4.5"], id: \.self) { value in
                            Text("\(value)★").tag(value)
                        }
                    }
                } header: {
                    Text("Your rating")
                }

                ForEach(Self.facets, id: \.key) { facet in
                    let options = available.options(for: facet.key)
                    if !options.isEmpty {
                        Section {
                            NavigationLink {
                                OptionPicker(
                                    title: facet.title,
                                    options: options,
                                    selection: binding(for: facet.key)
                                )
                            } label: {
                                HStack {
                                    Text(facet.title)
                                    Spacer()
                                    Text(label(for: facet.key, options: options))
                                        .foregroundColor(.secondary)
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Filters")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Clear") { draft = [:] }
                        .disabled(draft.isEmpty)
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Apply") {
                        onApply(draft)
                        dismiss()
                    }
                    .fontWeight(.semibold)
                }
            }
        }
    }

    private func label(for key: String, options: [FilterOption]) -> String {
        guard let value = draft[key] else { return "Any" }
        return options.first { $0.value == value }?.label ?? value
    }

    private func binding(for key: String) -> Binding<String> {
        Binding(
            get: { draft[key] ?? "" },
            set: { newValue in
                if newValue.isEmpty { draft.removeValue(forKey: key) } else { draft[key] = newValue }
            }
        )
    }

    private var ratedBinding: Binding<String> { binding(for: "rated") }
    private var minBinding: Binding<String> { binding(for: "ratingMin") }
}

/// One facet's options, searchable because a director list runs to sixty names.
private struct OptionPicker: View {
    let title: String
    let options: [FilterOption]
    @Binding var selection: String

    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    private var shown: [FilterOption] {
        guard !query.isEmpty else { return options }
        return options.filter { $0.label.localizedCaseInsensitiveContains(query) }
    }

    var body: some View {
        List {
            Button {
                selection = ""
                dismiss()
            } label: {
                HStack {
                    Text("Any")
                    Spacer()
                    if selection.isEmpty { Image(systemName: "checkmark").foregroundColor(.accentColor) }
                }
            }
            ForEach(shown) { option in
                Button {
                    selection = option.value
                    dismiss()
                } label: {
                    HStack {
                        Text(option.label)
                        Spacer()
                        Text("\(option.films)")
                            .foregroundColor(.secondary)
                            .monospacedDigit()
                        if selection == option.value {
                            Image(systemName: "checkmark").foregroundColor(.accentColor)
                        }
                    }
                }
            }
        }
        .searchable(text: $query, prompt: "Search \(title.lowercased())")
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
    }
}
