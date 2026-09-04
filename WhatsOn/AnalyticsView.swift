import SwiftUI
import Charts
import UniformTypeIdentifiers
import UIKit

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


// MARK: - Shareable card

/// One rendered image of the reader's history.
///
/// Deliberately not the scrolling page: a share card has one job, a fixed size,
/// and no scrolling — so it is laid out from scratch at a fixed 400×540 rather
/// than screenshotting a view built for a phone.
///
/// Two constraints come from `ImageRenderer`, which is synchronous and does not
/// inherit the environment. Posters must therefore be handed in already decoded
/// (anything still loading renders blank), and every colour is read from the
/// static theme tokens rather than `@Environment`, which would come back as
/// defaults.
private struct ShareCardView: View {
    let summary: AnalyticsSummary
    let posters: [UIImage]
    let topGenres: [String]
    let topDirector: String?
    let scopeNote: String?

    private var hours: String {
        let h = summary.runtimeMinutes / 60
        return h >= 1000 ? "\(h / 1000),\(String(format: "%03d", h % 1000))" : "\(h)"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("🎬 \(Brand.wordmark)".uppercased())
                .font(.caption.weight(.bold)).tracking(1.6)
                .foregroundColor(.mkAccent)

            Text("\(summary.films)")
                .font(.system(.largeTitle, design: .rounded).weight(.bold))
                .foregroundColor(.mkText)
                .minimumScaleFactor(0.5).lineLimit(1)
                .padding(.top, 6)

            Text("films — \(hours) hours in the dark")
                .font(.subheadline.weight(.medium))
                .foregroundColor(.mkMuted)

            if !posters.isEmpty {
                HStack(spacing: 6) {
                    ForEach(Array(posters.prefix(5).enumerated()), id: \.offset) { _, poster in
                        Image(uiImage: poster)
                            .resizable().scaledToFill()
                            .frame(width: 66, height: 99)
                            .clipShape(RoundedRectangle(cornerRadius: 5, style: .continuous))
                    }
                }
                .padding(.top, 20)
            }

            HStack(spacing: 26) {
                cardStat("Your mean", summary.meanRating.map { String(format: "%.2f", $0) } ?? "—")
                cardStat("Rated", "\(summary.rated)")
                if let offset = summary.tasteOffset {
                    cardStat("vs crowd", String(format: "%+.2f", offset))
                }
            }
            .padding(.top, 22)

            if !topGenres.isEmpty {
                Text(topGenres.prefix(4).joined(separator: " · "))
                    .font(.footnote.weight(.semibold))
                    .foregroundColor(.mkText.opacity(0.75))
                    .lineLimit(1)
                    .padding(.top, 18)
            }
            if let director = topDirector {
                Text("Most watched director — \(director)")
                    .font(.caption)
                    .foregroundColor(.mkMuted)
                    .lineLimit(1)
                    .padding(.top, 3)
            }

            Spacer(minLength: 0)

            if let scopeNote {
                Text(scopeNote)
                    .font(.caption2)
                    .foregroundColor(.mkMuted.opacity(0.8))
                    .lineLimit(1)
            }
        }
        .padding(26)
        .frame(width: 400, height: 540, alignment: .topLeading)
        // A shared image is the same image for everyone who sees it, so it is
        // laid out at the standard text size rather than the sender's. Without
        // this the card is 400x540 whatever the setting, and a reader using
        // Larger Text would export one with its own text clipped.
        .dynamicTypeSize(.large)
        .background(Color.mkBackground)
    }

    private func cardStat(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label.uppercased())
                .font(.caption2.weight(.bold)).tracking(0.7)
                .foregroundColor(.mkMuted)
            Text(value)
                .font(.system(.title2, design: .rounded).weight(.bold))
                .foregroundColor(.mkText)
        }
    }
}

/// A rendered card, held so the share sheet has something to hand over.
private struct RenderedCard: Identifiable {
    let id = UUID()
    let image: Image
}

/// Shows the card that is about to be shared, then hands it to the system
/// share sheet. Previewing first matters: the reader is about to post this.
private struct ShareCardSheet: View {
    let card: RenderedCard
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                Color.mkBackground.ignoresSafeArea()
                VStack(spacing: 22) {
                    card.image
                        .resizable().scaledToFit()
                        .frame(maxWidth: 340)
                        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 16, style: .continuous)
                                .stroke(Color.mkHairline, lineWidth: 1)
                        )
                        .shadow(color: .black.opacity(0.25), radius: 18, y: 8)

                    ShareLink(
                        item: card.image,
                        preview: SharePreview("My film diary", image: card.image)
                    ) {
                        Text("Share")
                            .font(.subheadline.weight(.semibold))
                            .foregroundColor(.mkText)
                            .padding(.horizontal, 26).frame(height: 46)
                    }
                    .buttonStyle(.plain)
                    .glassEffect(.regular.tint(Color.mkAccent).interactive(), in: Capsule())
                }
                .padding(24)
            }
            .navigationTitle("Share")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Done") { dismiss() }
                        .fontWeight(.semibold).foregroundColor(.mkAccent)
                }
            }
        }
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

    /// Which request the screen is currently waiting for.
    ///
    /// Every lens and filter tap starts a page request, and they do not come
    /// back in the order they were sent — the server does real work per request,
    /// so a heavier earlier one can land after a lighter later one. Without a
    /// guard the last response to arrive wins, which is not the same as the
    /// last one asked for: tapping Genres then Directors could leave Directors
    /// highlighted above genre data, and it stayed that way until the next tap,
    /// because `dimension` updates on tap while the content updates on arrival.
    ///
    /// A response is written only if its generation is still the current one.
    /// `inFlight` is the matching courtesy — cancelling the superseded request
    /// so the server stops working on an answer nobody will read — but the
    /// generation is what makes it correct, since a cancelled request may
    /// already be on its way back.
    @State private var loadGeneration = 0
    @State private var inFlight: Task<Void, Never>?

    /// The lens, and the filters narrowing the history under it. Both go
    /// straight into the query string, so the server stays the only place that
    /// knows how either is computed.
    @State private var dimension = "overview"
    @State private var filters: [String: String] = [:]

    /// The genre named on the taste map beyond its four corners, if the reader
    /// has tapped one. Cleared whenever the page reloads under a new lens.
    @State private var selectedGenre: String?

    @State private var showFilterSheet = false
    @State private var showImporter = false

    @State private var isResolving = false
    @State private var resolveStatus: String?

    @State private var renderedCard: RenderedCard?
    @State private var isRenderingCard = false

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
                        Task { await renderShareCard() }
                    } label: {
                        if isRenderingCard {
                            ProgressView().tint(.mkAccent)
                        } else {
                            Image(systemName: "square.and.arrow.up")
                        }
                    }
                    .foregroundColor(.mkAccent)
                    .disabled(analytics == nil || isRenderingCard)
                    .accessibilityLabel("Share your stats")
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        showImporter = true
                    } label: {
                        Image(systemName: "square.and.arrow.down")
                    }
                    .foregroundColor(.mkAccent)
                    .disabled(app.isImportingDiary)
                    .accessibilityLabel("Import Letterboxd export")
                }
            }
        }
        .sheet(item: $renderedCard) { card in
            ShareCardSheet(card: card)
        }
        .sheet(isPresented: $showFilterSheet) {
            if let a = analytics {
                FilterSheet(available: a.filters.available, applied: filters) { next in
                    filters = next
                    reload()
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
            case .success(let urls): importExport(urls: urls)
            case .failure(let error): app.report(failure: error.localizedDescription)
            }
        }
        .task {
            seedFromSnapshot()
            await load()
        }
        // An import can now finish while this screen is open, because it is no
        // longer this screen running it. The counter changes once per completed
        // import, which is the cue to re-read — and to drop a lens and filters
        // that describe a history that has just been replaced.
        .onChange(of: app.diaryImportGeneration) {
            filters = [:]
            dimension = "overview"
            reload()
        }
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
                                reload()
                            } label: {
                                HStack(spacing: 4) {
                                    Text(chip.label)
                                    Image(systemName: "xmark").font(.caption2.weight(.bold))
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
                            reload()
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
                            reload()
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
                if let profile = a.profile { profileSections(profile) }
                if let rating = a.rating { ratingChart(rating) }
                if let quadrant = a.quadrant { quadrantChart(quadrant) }
                if let watchlist = a.watchlist { watchlistCard(watchlist) }
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
                    if a.dimension == "genres", let quadrant = a.quadrant { quadrantChart(quadrant) }
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

    // MARK: Profile

    /// What the film database says about a history, in the slot the poster wall
    /// used to hold.
    ///
    /// Each block is a distribution rather than a list of favourites, and each
    /// is built from a field TMDB was already returning and the cache used to
    /// discard. Horizontal bars throughout: the labels are words of varying
    /// length ("Everyone has seen it", "Under $1M"), and words read along a bar
    /// where they would have to be rotated under a column.
    @ViewBuilder
    private func profileSections(_ profile: AnalyticsProfile) -> some View {
        if let reach = profile.reach {
            distributionCard(
                "How far off the beaten path",
                note: "\(reach.covered) films",
                buckets: reach.buckets,
                caption: "By how many people have scored each film on TMDB — reach, not quality. The top row is the films everyone has seen."
            )
        }
        if let scale = profile.scale {
            distributionCard(
                "What they cost to make",
                note: "\(scale.covered) films",
                buckets: scale.buckets,
                caption: "Budget separates a festival film from a franchise one more cleanly than genre does. Films with no budget on record are left out."
            )
        }
        if let certifications = profile.certifications, !certifications.isEmpty {
            distributionCard(
                "Certificates",
                note: nil,
                buckets: certifications,
                caption: nil
            )
        }
        if profile.franchise != nil || profile.engagement != nil {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 148), spacing: 10)], spacing: 10) {
                if let franchise = profile.franchise, franchise.resolved > 0 {
                    tile("Franchise films", "\(Int(franchise.share))%",
                         detail: "\(franchise.films) of \(franchise.resolved)")
                }
                if let engagement = profile.engagement {
                    if engagement.liked > 0 {
                        tile("Liked", "\(engagement.liked)",
                             detail: engagement.likedUnrated > 0
                                ? "\(engagement.likedUnrated) without a score" : nil)
                    }
                    if engagement.reviewed > 0 {
                        tile("Written about", "\(engagement.reviewed)", detail: "of \(engagement.films) films")
                    }
                }
            }
        }
    }

    /// One distribution as horizontal bars, each labelled with its count and,
    /// where the films in it were scored, the mean they were given.
    private func distributionCard(
        _ title: String,
        note: String?,
        buckets: [ProfileBucket],
        caption captionText: String?
    ) -> some View {
        // Shares of the largest bucket rather than of the total: with four or
        // five buckets a share of the total leaves every bar short, and the
        // comparison a reader makes here is between the bars.
        let largest = max(buckets.map(\.films).max() ?? 1, 1)

        return VStack(alignment: .leading, spacing: 8) {
            sectionHeader(title, note: note)
            VStack(spacing: 0) {
                ForEach(Array(buckets.enumerated()), id: \.element.id) { index, bucket in
                    VStack(alignment: .leading, spacing: 5) {
                        HStack(alignment: .firstTextBaseline) {
                            Text(bucket.label)
                                .font(.subheadline).foregroundColor(.mkText)
                                .lineLimit(1).minimumScaleFactor(0.8)
                            Spacer(minLength: 8)
                            if let mean = bucket.meanRating {
                                Text(String(format: "%.2f★", mean))
                                    .font(.caption).foregroundColor(.mkMuted).monospacedDigit()
                            }
                            Text("\(bucket.films)")
                                .font(.caption.weight(.semibold))
                                .foregroundColor(.mkText).monospacedDigit()
                        }
                        GeometryReader { geo in
                            Capsule()
                                .fill(Color.mkAccent.opacity(0.85))
                                .frame(width: max(geo.size.width * (Double(bucket.films) / Double(largest)), 3))
                        }
                        .frame(height: 6)
                    }
                    .padding(.vertical, 9).padding(.horizontal, 13)
                    if index < buckets.count - 1 {
                        Divider().overlay(Color.mkBorder)
                    }
                }
            }
            .background(Color.mkSurface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            if let captionText { caption(captionText) }
        }
        .accessibilityElement(children: .contain)
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
            reload()
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
                            .font(.caption2.weight(.bold))
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

    // MARK: Posters

    /// The best-rated films, as artwork. Analytics was the only screen in a film
    /// app with no film on it.
    // MARK: The taste quadrant

    /// Genres on two axes: how often against how highly. The crosshair sits at
    /// the medians of this history, so the corners describe the reader relative
    /// to themselves rather than to an absolute scale.
    /// The four points a reader should actually read, one per corner.
    ///
    /// Labelling every point was the whole problem: ten genre names, drawn at a
    /// fixed offset above ten dots inside a chart a couple of hundred points
    /// tall, land on top of each other and on the dots, and the result reads as
    /// noise rather than as a map. The corners are where the meaning is — the
    /// caption below the chart is written about them — so the extreme of each
    /// quadrant is named and the rest are reachable by tapping.
    ///
    /// Distance is measured on each axis separately as a share of that axis's
    /// own spread, because films and ratings are not comparable units: a genre
    /// twenty films out and a genre a star and a half out are both a long way
    /// from the middle, and raw arithmetic would let the film count win every
    /// time.
    private func cornerLabels(_ q: AnalyticsQuadrant) -> Set<String> {
        let films = q.points.map { Double($0.films) }
        let ratings = q.points.map(\.meanRating)
        let filmSpread = max((films.max() ?? 0) - (films.min() ?? 0), 0.0001)
        let ratingSpread = max((ratings.max() ?? 0) - (ratings.min() ?? 0), 0.0001)

        var picked: Set<String> = []
        // (moreFilmsThanTypical, ratedAboveTypical) — the four corners.
        for wantRight in [true, false] {
            for wantTop in [true, false] {
                let corner = q.points.filter {
                    (Double($0.films) >= q.filmsMedian) == wantRight
                        && ($0.meanRating >= q.ratingMedian) == wantTop
                }
                let furthest = corner.max { a, b in
                    let da = abs(Double(a.films) - q.filmsMedian) / filmSpread
                        + abs(a.meanRating - q.ratingMedian) / ratingSpread
                    let db = abs(Double(b.films) - q.filmsMedian) / filmSpread
                        + abs(b.meanRating - q.ratingMedian) / ratingSpread
                    return da < db
                }
                if let furthest { picked.insert(furthest.name) }
            }
        }
        return picked
    }

    private func quadrantChart(_ q: AnalyticsQuadrant) -> some View {
        let corners = cornerLabels(q)
        // A tapped genre is named whether or not it is a corner, and the corners
        // stay named so the chart still reads before anyone touches it.
        let labelled = selectedGenre.map { corners.union([$0]) } ?? corners

        return VStack(alignment: .leading, spacing: 8) {
            sectionHeader("Taste map", note: "watched against rated")
            Chart {
                RuleMark(x: .value("Median films", q.filmsMedian))
                    .foregroundStyle(Color.mkHairline)
                RuleMark(y: .value("Median rating", q.ratingMedian))
                    .foregroundStyle(Color.mkHairline)
                ForEach(q.points) { point in
                    // Double on both axes: the median RuleMarks above are
                    // Doubles, and Swift Charts needs one plottable type per axis.
                    PointMark(
                        x: .value("Films", Double(point.films)),
                        y: .value("Mean rating", point.meanRating)
                    )
                    .foregroundStyle(
                        point.name == selectedGenre
                            ? Color.mkAccent
                            : (point.meanRating >= q.ratingMedian
                               ? Color.mkAccent.opacity(0.75)
                               : Color.mkText.opacity(0.35))
                    )
                    .symbolSize(point.name == selectedGenre ? 220 : 110)
                    .annotation(position: .top, spacing: 3) {
                        if labelled.contains(point.name) {
                            Text(point.name)
                                .font(.caption2.weight(.semibold))
                                .foregroundColor(point.name == selectedGenre ? .mkAccent : .mkMuted)
                                .fixedSize()
                        }
                    }
                }
            }
            .chartXAxis { AxisMarks { _ in
                AxisGridLine().foregroundStyle(Color.mkHairline)
                AxisValueLabel()
            } }
            .chartYAxis { AxisMarks(position: .leading) { _ in
                AxisGridLine().foregroundStyle(Color.mkHairline)
                AxisValueLabel()
            } }
            // Taller than it was. The labels need somewhere to sit that is not
            // on top of another point.
            .frame(height: 260)
            .padding(.top, 6)

            // Every genre on the map, including the ones the chart leaves
            // unnamed. Tapping one names and highlights it, which is how the
            // detail survives having been taken off the plot.
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(q.points) { point in
                        Button {
                            withAnimation(.easeOut(duration: 0.18)) {
                                selectedGenre = selectedGenre == point.name ? nil : point.name
                            }
                        } label: {
                            Text(point.name)
                                .font(.caption.weight(.semibold))
                                .foregroundColor(point.name == selectedGenre ? .mkOnAccent : .mkMuted)
                                .padding(.horizontal, 10).padding(.vertical, 5)
                                .background(
                                    point.name == selectedGenre ? Color.mkAccent : Color.mkSurface,
                                    in: Capsule()
                                )
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(
                            "\(point.name), \(point.films) films, average \(String(format: "%.1f", point.meanRating)) stars"
                        )
                    }
                }
                .padding(.horizontal, 1)
            }
            .scrollBounceBehavior(.basedOnSize, axes: .horizontal)

            if let name = selectedGenre, let point = q.points.first(where: { $0.name == name }) {
                Text("\(point.name) — \(point.films) films, averaging \(String(format: "%.2f", point.meanRating))★")
                    .font(.footnote).foregroundColor(.mkText)
            } else {
                caption("Right of the line is what you watch most; above it is what you rate best. The top-left corner is what you love but rarely reach for.")
            }
        }
    }

    // MARK: Watchlist

    /// Intent against history — the one thing the diary alone cannot say.
    private func watchlistCard(_ w: AnalyticsWatchlist) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionHeader("Saved for later", note: "\(w.saved) on your watchlist")
            HStack(spacing: 10) {
                tile("Watched", "\(w.watched)",
                     detail: w.conversion.map { "\(Int($0))% of saved" })
                tile("Still waiting", "\(w.waiting)", detail: nil)
            }
            if !w.stillWaiting.isEmpty {
                VStack(spacing: 0) {
                    ForEach(Array(w.stillWaiting.enumerated()), id: \.element.id) { index, film in
                        HStack {
                            Text(film.name)
                                .font(.subheadline).foregroundColor(.mkText).lineLimit(1)
                            Spacer(minLength: 10)
                            if let year = film.year {
                                Text(String(year))
                                    .font(.caption).foregroundColor(.mkMuted).monospacedDigit()
                            }
                        }
                        .padding(.vertical, 9).padding(.horizontal, 13)
                        if index < w.stillWaiting.count - 1 {
                            Divider().overlay(Color.mkBorder)
                        }
                    }
                }
                .background(Color.mkSurface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
        }
    }

    private func highlightCards(_ highlights: [AnalyticsHighlight]) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            ForEach(highlights) { group in
                if !group.entries.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Button {
                            dimension = group.id
                            reload()
                        } label: {
                            HStack {
                                Text(group.title)
                                    .font(.headline).foregroundColor(.mkText)
                                Spacer()
                                Text("See all")
                                    .font(.caption.weight(.semibold)).foregroundColor(.mkAccent)
                                Image(systemName: "chevron.right")
                                    .font(.caption2.weight(.bold)).foregroundColor(.mkAccent)
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
            // A decorative glyph standing in for a missing screenful, not copy — the
            // sentence beside it is what carries the meaning and scales. Sized to hold
            // the empty state together rather than to be read.
            Image(systemName: "chart.bar.xaxis").font(.system(size: 46)).foregroundColor(.mkMuted)
            Text("No diary yet").font(.title3).bold().foregroundColor(.mkText)
            Text("Download your export from letterboxd.com/settings/data. In Files, tap and hold the zip and choose Uncompress — then pick the folder here.")
                .font(.subheadline).foregroundColor(.mkMuted)
                .multilineTextAlignment(.center).padding(.horizontal, 34)
            if let message = loadError {
                Text(message).font(.footnote).foregroundColor(.red)
                    .multilineTextAlignment(.center).padding(.horizontal, 34)
            }
            Button {
                showImporter = true
            } label: {
                HStack(spacing: 8) {
                    if app.isImportingDiary { ProgressView().tint(.mkText).scaleEffect(0.8) }
                    else { Image(systemName: "folder.badge.plus") }
                    Text(app.isImportingDiary ? "Importing…" : "Import Letterboxd export")
                        .font(.subheadline.weight(.semibold))
                }
                .foregroundColor(.mkText)
                .padding(.horizontal, 20).frame(height: 48)
            }
            .buttonStyle(.plain)
            .glassEffect(.regular.tint(Color.mkAccent).interactive(), in: Capsule())
            .disabled(app.isImportingDiary)
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

    // MARK: Sharing

    /// Build the card and hand it to the share sheet.
    ///
    /// The posters are awaited first on purpose: `ImageRenderer` draws in one
    /// synchronous pass, so any artwork still in flight would be rendered as a
    /// blank rectangle. They come from the same cache the feed uses, so after a
    /// normal session they are already on disk and this costs nothing.
    @MainActor private func renderShareCard() async {
        guard let a = analytics else { return }
        isRenderingCard = true
        defer { isRenderingCard = false }

        var posters: [UIImage] = []
        for film in (a.mosaic ?? []).prefix(5) {
            guard let urlString = film.posterUrl,
                  let image = await ImageCache.shared.image(for: urlString) else { continue }
            posters.append(image)
        }

        let genres = a.highlights?.first(where: { $0.id == "genres" })?.entries.map(\.label) ?? []
        let director = a.highlights?.first(where: { $0.id == "directors" })?.entries.first?.label

        let card = ShareCardView(
            summary: a.summary,
            posters: posters,
            topGenres: genres,
            topDirector: director,
            scopeNote: a.scope.filtered
                ? "\(a.scope.films) of \(a.scope.filmsTotal) films"
                : nil
        )

        let renderer = ImageRenderer(content: card)
        // Retina: the card is shared at 400pt wide and will be viewed at full size.
        renderer.scale = 3
        guard let ui = renderer.uiImage else { return }
        renderedCard = RenderedCard(image: Image(uiImage: ui))
    }

    // MARK: Networking

    /// The signature the current view's snapshot is filed under.
    private static func signature(dimension: String, filters: [String: String]) -> String {
        AnalyticsSnapshot.signature(dimension: dimension, filters: filters)
    }

    /// Put last session's numbers on screen before the request goes out.
    ///
    /// Only for the view actually being opened — the signature covers the lens
    /// and every filter — and only when there is nothing on screen already, so
    /// this can never overwrite a fresher answer. A failed decode is ignored
    /// rather than surfaced: the live request is moments behind it, and a
    /// stale-cache error is not something a reader can act on.
    @MainActor private func seedFromSnapshot() {
        guard analytics == nil,
              let data = AnalyticsSnapshot.load(
                  signature: Self.signature(dimension: dimension, filters: filters)
              ),
              let cached = try? JSONDecoder().decode(AnalyticsResponse.self, from: data)
        else { return }
        analytics = cached
        // The page has content now, so the next request refreshes in place
        // rather than replacing it with a spinner.
        isLoading = false
    }

    /// Start a page request, replacing whatever was already running.
    ///
    /// Every lens tap, filter change and drill goes through here rather than
    /// starting a bare `Task`, so that there is exactly one request the screen
    /// is waiting for at any moment.
    @MainActor private func reload() {
        inFlight?.cancel()
        inFlight = Task { await load() }
    }

    @MainActor private func load() async {
        loadGeneration &+= 1
        let generation = loadGeneration
        isLoading = analytics == nil

        let result: Result<AnalyticsResponse, Error>
        do {
            var params = filters
            params["dimension"] = dimension
            let fetched: (value: AnalyticsResponse, data: Data) =
                try await APIService.shared.getWithData("/analytics", params: params, token: app.token)
            AnalyticsSnapshot.save(
                fetched.data,
                signature: Self.signature(dimension: dimension, filters: filters)
            )
            result = .success(fetched.value)
        } catch {
            result = .failure(error)
        }

        // Someone has asked a newer question. That request owns the screen now,
        // spinner included, so this one leaves without touching anything —
        // including on failure, where reporting a cancelled request's error
        // would put a stale message over a load that is still going fine.
        guard generation == loadGeneration else { return }

        switch result {
        case .success(let response):
            analytics = response
            // The old selection named a genre from the previous slice, which
            // this one may not even contain.
            selectedGenre = nil
            loadError = nil
        case .failure(let error):
            if let api = error as? APIError {
                if case .unauthorized = api { app.logout() }
                loadError = api.errorDescription
            } else {
                loadError = error.localizedDescription
            }
        }
        isLoading = false
    }

    /// Read the picked files, then hand them off.
    ///
    /// Reading is local and quick, so it stays here where the picker is. The
    /// upload does not: it goes to `AppState`, which outlives this screen, so
    /// leaving the page mid-import no longer loses the progress, the result or
    /// the error. The banner follows the reader wherever they go.
    @MainActor private func importExport(urls: [URL]) {
        let files: [LetterboxdExport.File]
        do {
            files = try LetterboxdExport.read(urls: urls)
        } catch {
            app.report(
                failure: (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            )
            return
        }
        app.importDiary(files: files)
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
        ("country", "Country"),
        ("writer", "Writer"),
        ("cinematographer", "Cinematographer"),
        ("composer", "Composer"),
        ("studio", "Studio"),
        ("keyword", "Theme"),
        ("certification", "Certificate"),
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

                // Both come out of the export and neither is a score: a like is
                // the unscored yes, and a review is the films you had something
                // to say about. They sit apart from the star rating for that
                // reason.
                Section {
                    Picker("Liked", selection: likedBinding) {
                        Text("All films").tag("")
                        Text("Liked only").tag("yes")
                        Text("Not liked").tag("no")
                    }
                    Picker("Reviewed", selection: reviewedBinding) {
                        Text("All films").tag("")
                        Text("Reviewed only").tag("yes")
                        Text("Not reviewed").tag("no")
                    }
                } header: {
                    Text("From your export")
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
    private var likedBinding: Binding<String> { binding(for: "liked") }
    private var reviewedBinding: Binding<String> { binding(for: "reviewed") }
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
