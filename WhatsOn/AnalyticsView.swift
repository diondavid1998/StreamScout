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
        // The server reads at most twenty; the export has six, so anything past
        // that is a folder of something else.
        return Array(files.prefix(20))
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
/// Everything above the People section is computed from the uploaded CSVs and
/// needs no network at all, so it renders the moment an import lands. People and
/// genres are the exception — no Letterboxd export contains a director or a
/// genre — and they fill in only when the reader asks.
struct AnalyticsView: View {
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss

    @State private var analytics: AnalyticsResponse?
    @State private var isLoading = true
    @State private var loadError: String?

    @State private var showImporter = false
    @State private var importStatus: String?
    @State private var importError: String?
    @State private var isImporting = false

    @State private var isResolving = false
    @State private var resolveStatus: String?

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
        if isLoading {
            VStack { Spacer(); ProgressView().tint(.mkAccent); Spacer() }
        } else if let analytics, analytics.summary.films > 0 {
            ScrollView {
                VStack(alignment: .leading, spacing: 26) {
                    if let importStatus { banner(importStatus, tone: .accent) }
                    if let importError { banner(importError, tone: .error) }
                    summarySection(analytics)
                    ratingSection(analytics)
                    erasSection(analytics)
                    if analytics.habits.hasDates { habitsSection(analytics) } else { noDiaryNote }
                    peopleSection(analytics)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 18)
            }
        } else {
            emptyState
        }
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
                        .font(.system(size: 15, weight: .semibold))
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

    private var noDiaryNote: some View {
        VStack(alignment: .leading, spacing: 6) {
            sectionHeader("Habits", note: "needs diary.csv")
            Text("Your export had ratings but no diary, so there are no watch dates to chart. Re-export with the diary included to unlock months, weekdays and streaks.")
                .font(.footnote).foregroundColor(.mkMuted)
        }
    }

    // MARK: Bands

    private func summarySection(_ a: AnalyticsResponse) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionHeader("At a glance")
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 12)], spacing: 12) {
                stat("Films", "\(a.summary.films)", detail: a.summary.rewatches > 0 ? "\(a.summary.viewings) viewings" : nil)
                stat("Time in the dark", hours(a.summary.runtimeMinutes),
                     detail: a.coverage.pending > 0 ? "of \(a.coverage.resolved) resolved" : nil)
                stat("Your mean", a.summary.meanRating.map { String(format: "%.2f", $0) } ?? "—",
                     detail: "\(a.summary.rated) rated")
                stat("Versus the crowd", offsetLabel(a.summary.tasteOffset),
                     detail: (a.summary.comparedOn ?? 0) > 0 ? "over \(a.summary.comparedOn ?? 0) films" : "not compared yet")
            }
        }
    }

    private func ratingSection(_ a: AnalyticsResponse) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionHeader("Rating", note: "\(a.summary.rated) of \(a.summary.films) rated")
            card {
                Chart(a.rating.histogram) { bucket in
                    BarMark(
                        x: .value("Rating", bucket.rating),
                        y: .value("Films", bucket.films),
                        width: .fixed(18)
                    )
                    .foregroundStyle(Color.mkAccent)
                    .cornerRadius(4)
                }
                .chartXScale(domain: 0.25...5.25)
                // Whole stars only: ten half-star labels collide at phone width.
                .chartXAxis { AxisMarks(values: [1, 2, 3, 4, 5]) }
                .chartYAxis { AxisMarks(position: .leading) }
                .frame(height: 168)
            }
            if let mode = a.rating.mode, mode.films > 0 {
                caption("Most common rating: \(stars(mode.rating)) — \(mode.films) films")
            }

            if !a.rating.byYear.isEmpty {
                card {
                    Chart(a.rating.byYear) { year in
                        LineMark(x: .value("Year", year.year), y: .value("Mean", year.meanRating ?? 0))
                            .foregroundStyle(Color.mkAccent)
                            .lineStyle(StrokeStyle(lineWidth: 2))
                        PointMark(x: .value("Year", year.year), y: .value("Mean", year.meanRating ?? 0))
                            .foregroundStyle(Color.mkAccent)
                            .symbolSize(60)
                    }
                    .chartYScale(domain: 0...5)
                    .frame(height: 150)
                }
                caption("Your mean rating by year watched")
            }

            if !a.rating.hottestTakes.above.isEmpty || !a.rating.hottestTakes.below.isEmpty {
                deltaList("Hottest takes", above: a.rating.hottestTakes.above, below: a.rating.hottestTakes.below)
            }
        }
    }

    private func erasSection(_ a: AnalyticsResponse) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionHeader("Eras")
            if !a.eras.decades.isEmpty {
                card {
                    Chart(a.eras.decades) { decade in
                        BarMark(x: .value("Decade", decade.decade), y: .value("Films", decade.films), width: .fixed(22))
                            .foregroundStyle(Color.mkAccent)
                            .cornerRadius(4)
                    }
                    .frame(height: 160)
                }
            }
            if let lag = a.eras.lagYearsMedian {
                caption("You typically watch a film \(String(format: "%.0f", lag)) years after it comes out.")
            }
            if !a.eras.languages.isEmpty {
                chipRow(a.eras.languages.map { "\($0.code.uppercased()) · \($0.films)" })
            }
        }
    }

    private func habitsSection(_ a: AnalyticsResponse) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionHeader("Habits")
            if !a.habits.weekday.isEmpty {
                card {
                    Chart(a.habits.weekday) { day in
                        BarMark(x: .value("Day", String(day.day.prefix(3))), y: .value("Films", day.films), width: .fixed(24))
                            .foregroundStyle(Color.mkAccent)
                            .cornerRadius(4)
                    }
                    .frame(height: 150)
                }
                caption("When you actually watch")
            }
            if let streaks = a.habits.streaks {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 12)], spacing: 12) {
                    stat("Longest streak", "\(streaks.longestStreakDays)", detail: "days in a row")
                    stat("Longest gap", "\(streaks.longestGapDays)", detail: "days off")
                    stat("Active days", "\(streaks.activeDays)", detail: nil)
                    stat("Rewatches", "\(a.summary.rewatches)", detail: nil)
                }
            }
            if !a.habits.mostRewatched.isEmpty {
                rankedList("Returned to most", a.habits.mostRewatched.map { ($0.name, "\($0.viewings)×") })
            }
            if !a.habits.topTags.isEmpty {
                chipRow(a.habits.topTags.map { "\($0.tag) · \($0.films)" })
            }
        }
    }

    private func peopleSection(_ a: AnalyticsResponse) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionHeader("Genres & people", note: a.coverage.pending > 0 ? "\(a.coverage.resolved) of \(a.coverage.films)" : nil)

            if a.coverage.pending > 0 {
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
                            .font(.system(size: 14, weight: .semibold))
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

            if !a.people.genres.isEmpty {
                rankedList("Genres", a.people.genres.map { ($0.name, ratingLabel($0)) })
            }
            if !a.people.directors.isEmpty {
                rankedList("Directors", a.people.directors.map { ($0.name, ratingLabel($0)) })
            }
            if !a.people.affinity.isEmpty {
                rankedList("You love these directors",
                           a.people.affinity.map { ($0.name, $0.delta.map { d in String(format: "%+.1f", d) } ?? "—") },
                           note: "mean rating against your own, three films minimum")
            }
            if !a.people.cast.isEmpty {
                rankedList("Faces you see most", a.people.cast.map { ($0.name, "\($0.films)") },
                           note: "top-billed roles only")
            }
        }
    }

    // MARK: Pieces

    private func sectionHeader(_ title: String, note: String? = nil) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title).font(.system(size: 19, weight: .bold)).foregroundColor(.mkText)
            Spacer()
            if let note {
                Text(note).font(.caption).foregroundColor(.mkMuted)
            }
        }
    }

    private func stat(_ label: String, _ value: String, detail: String?) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label.uppercased())
                .font(.system(size: 10, weight: .bold)).tracking(0.8)
                .foregroundColor(.mkMuted)
            Text(value)
                .font(.system(size: 26, weight: .bold, design: .rounded))
                .foregroundColor(.mkText)
                .minimumScaleFactor(0.6).lineLimit(1)
            if let detail {
                Text(detail).font(.caption2).foregroundColor(.mkMuted).lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Color.mkSurface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func card<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        content()
            .padding(12)
            .background(Color.mkSurface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func caption(_ text: String) -> some View {
        Text(text).font(.caption).foregroundColor(.mkMuted)
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

    private func rankedList(_ title: String, _ rows: [(String, String)], note: String? = nil) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(title).font(.system(size: 14, weight: .semibold)).foregroundColor(.mkText)
                Spacer()
                if let note { Text(note).font(.caption2).foregroundColor(.mkMuted) }
            }
            .padding(.bottom, 8)
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                HStack {
                    Text(row.0).font(.system(size: 14)).foregroundColor(.mkText).lineLimit(1)
                    Spacer(minLength: 12)
                    Text(row.1).font(.system(size: 13, weight: .semibold)).foregroundColor(.mkAccent)
                }
                .padding(.vertical, 7)
                Divider().overlay(Color.mkBorder)
            }
        }
        .padding(14)
        .background(Color.mkSurface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func deltaList(_ title: String, above: [TitleDelta], below: [TitleDelta]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.system(size: 14, weight: .semibold)).foregroundColor(.mkText)
            ForEach(above.prefix(3)) { film in
                deltaRow(film, positive: true)
            }
            ForEach(below.prefix(3)) { film in
                deltaRow(film, positive: false)
            }
        }
        .padding(14)
        .background(Color.mkSurface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func deltaRow(_ film: TitleDelta, positive: Bool) -> some View {
        HStack {
            // Direction is carried by the sign and the arrow as well as colour,
            // so the row still reads without it.
            Image(systemName: positive ? "arrow.up" : "arrow.down")
                .font(.system(size: 11, weight: .bold))
                .foregroundColor(positive ? .blue : .red)
            Text(film.name).font(.system(size: 14)).foregroundColor(.mkText).lineLimit(1)
            Spacer(minLength: 10)
            Text(String(format: "%+.1f", film.delta))
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(positive ? .blue : .red)
        }
    }

    private func chipRow(_ labels: [String]) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(labels, id: \.self) { label in
                    Text(label)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(.mkMuted)
                        .padding(.horizontal, 11).padding(.vertical, 7)
                        .background(Color.mkSubtleFill, in: Capsule())
                }
            }
        }
    }

    // MARK: Formatting

    private func hours(_ minutes: Int) -> String {
        guard minutes > 0 else { return "—" }
        let days = minutes / 1440
        let remainder = (minutes % 1440) / 60
        return days > 0 ? "\(days)d \(remainder)h" : "\(minutes / 60)h"
    }

    private func offsetLabel(_ offset: Double?) -> String {
        guard let offset else { return "—" }
        return String(format: "%+.2f", offset)
    }

    private func stars(_ rating: Double) -> String {
        rating == rating.rounded() ? "\(Int(rating))★" : String(format: "%.1f★", rating)
    }

    private func ratingLabel(_ stat: PersonStat) -> String {
        guard let mean = stat.meanRating else { return "\(stat.films)" }
        return String(format: "%d · %.1f★", stat.films, mean)
    }

    // MARK: Work

    @MainActor private func load() async {
        isLoading = analytics == nil
        do {
            let response: AnalyticsResponse = try await APIService.shared.get("/analytics", token: app.token)
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
            importError = error.localizedDescription
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

        while remaining > 0 && rounds < 200 {
            rounds += 1
            resolveStatus = "\(remaining) films to look up…"
            do {
                let response: ResolveResponse = try await APIService.shared.post(
                    "/analytics/resolve", body: ["limit": 60], token: app.token, timeout: 120
                )
                let next = response.pending ?? 0
                if next >= remaining { remaining = next; break }
                remaining = next
            } catch {
                resolveStatus = "Stopped — \(remaining) still to look up."
                await load()
                return
            }
        }

        resolveStatus = remaining == 0 ? nil : "\(remaining) could not be matched."
        await load()
    }
}
