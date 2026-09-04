//
//  DetailSheet.swift
//  WhatsOn
//
// One title in full, and the filmographies reachable from its cast.
//

import SwiftUI

// MARK: - Detail Sheet

struct DetailSheet: View {
    let movie: CatalogItem
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var details: TitleDetails?
    @State private var isLoadingExtras = true
    @State private var detailsError: String? = nil
    @State private var isTogglingWatched = false
    @State private var isTogglingWatchlist = false
    @State private var isTogglingCurrent = false
    /// Drives the hero wash. One title on screen, so a full-strength tint reads
    /// as this film's colour rather than as noise.
    @State private var dominantColor: Color? = nil

    var isWatched: Bool { app.watchedIds.contains(movie.id) }
    var isWatchlisted: Bool { app.watchlistIds.contains(movie.id) }
    var isCurrentlyWatching: Bool { app.currentlyWatchingIds.contains(movie.id) }
    var isTV: Bool { movie.mediaType == "tv" }
    var mediaType: String { movie.mediaType ?? "movie" }
    var tmdbId: String {
        let parts = movie.id.split(separator: "-")
        return parts.count >= 2 ? String(parts.last!) : movie.id
    }

    var body: some View {
        NavigationStack {
            ZStack(alignment: .bottom) {
                Color.mkBackground.ignoresSafeArea()

                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        heroSection

                        VStack(alignment: .leading, spacing: 22) {
                            // "Where can I watch this" is the question the app exists
                            // to answer, so it comes before anything else.
                            if let providers = movie.availableOn, !providers.isEmpty {
                                sectionBlock("Streaming on your services") {
                                    serviceGrid(providers)
                                }
                            }

                            let ratings = buildRatings()
                            if !ratings.isEmpty {
                                sectionBlock("Scores") {
                                    ScoreStrip(entries: ratings, compact: false)
                                }
                            }

                            if let overview = movie.overview ?? details?.overview, !overview.isEmpty {
                                sectionBlock("Overview") {
                                    Text(overview)
                                        .font(.footnote)
                                        .foregroundColor(.mkMuted)
                                        .lineSpacing(3)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                            }

                            let genres = details?.genres ?? movie.genres ?? []
                            if !genres.isEmpty {
                                sectionBlock("Genres") {
                                    FlowRow(spacing: 6) {
                                        ForEach(genres, id: \.self) { PillChip(text: $0, color: .mkMuted) }
                                    }
                                }
                            }

                            if isLoadingExtras {
                                HStack(spacing: 8) {
                                    ProgressView().scaleEffect(0.8).tint(.mkAccent)
                                    Text("Loading cast & more…")
                                        .font(.caption).foregroundColor(.mkMuted)
                                }
                            } else if let d = details {
                                extrasSection(d)
                                if let extras = d.watchmode, extras.hasContent {
                                    watchmodeSection(extras)
                                }
                            } else if let err = detailsError {
                                Text(err).font(.caption).foregroundColor(.mkMuted).frame(maxWidth: .infinity)
                            }
                        }
                        .padding(.horizontal, 20)
                        .padding(.top, 22)
                        // Clear the floating action bar.
                        .padding(.bottom, 108)
                    }
                }
                .ignoresSafeArea(edges: .top)

                actionBar
            }
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button { dismiss() } label: {
                        Image(systemName: "xmark")
                            .font(.footnote.weight(.bold))
                            .foregroundColor(.mkText)
                            .frame(width: 30, height: 30)
                            .glassEffect(.regular.interactive(), in: Circle())
                    }
                    .accessibilityLabel("Close")
                }
            }
            .toolbarBackground(.hidden, for: .navigationBar)
            .navigationBarTitleDisplayMode(.inline)
        }
        .onAppear {
            if let urlString = movie.posterUrl {
                dominantColor = ColorCache.shared.cachedColor(for: urlString)
            }
        }
        .task(id: movie.posterUrl) {
            guard let urlString = movie.posterUrl else { return }
            if let color = await ColorCache.shared.fetchColor(for: urlString) {
                withAnimation(.easeIn(duration: 0.45)) { dominantColor = color }
            }
        }
        .task {
            await loadDetails()
            await loadWatched()
        }
    }

    // MARK: Hero

    /// Height of the hero. It was 330 — roughly the top 40% of a phone — which
    /// meant opening a title landed you on artwork and had you scrolling to
    /// reach the answer you tapped for. 272 still clears a three-line title,
    /// a two-line tagline and the 156pt poster without clipping.
    static let heroHeight: CGFloat = 272

    /// The one place the poster's dominant colour earns a full wash — a single
    /// screen showing a single title, rather than a feed where every row would
    /// pull in a different direction.
    var heroSection: some View {
        ZStack(alignment: .bottomLeading) {
            LinearGradient(
                colors: [
                    (dominantColor ?? .mkAccent).opacity(0.55),
                    (dominantColor ?? .mkAccent).opacity(0.16),
                    Color.mkBackground,
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .frame(height: Self.heroHeight)

            backdropWash

            HStack(alignment: .bottom, spacing: 14) {
                heroPoster
                VStack(alignment: .leading, spacing: 0) {
                    Text(movie.title)
                        .font(.title.weight(.bold))
                        .foregroundColor(.mkText)
                        .lineLimit(3)
                        .fixedSize(horizontal: false, vertical: true)
                    if let t = details?.tagline, !t.isEmpty {
                        Text("“\(t)”")
                            .font(.caption)
                            .italic()
                            .foregroundColor(.mkText.opacity(0.72))
                            .lineLimit(2)
                            .padding(.top, 6)
                    }
                    heroMetaLine
                        .padding(.top, 9)
                }
                .padding(.bottom, 4)
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 18)
        }
        .frame(height: Self.heroHeight)
        .clipped()
    }

    /// The backdrop image, blurred into the wash rather than shown as a framed
    /// picture — it is atmosphere here, not content.
    ///
    /// Backdrops only. This used to fall back to the poster, and since `details`
    /// arrives after the sheet does, every title opened on its own poster scaled
    /// up to fill the hero — the tapped card, enlarged. Without a backdrop the
    /// dominant-colour gradient underneath stands on its own.
    ///
    /// The image is an overlay on a fixed-height `Color.clear`, not a framed
    /// image. `scaledToFill` reports a layout size that *fills* the proposal, so
    /// it overflows in one axis; `.frame(height:)` then adopts its child's width,
    /// and `.clipped()` only clips pixels, never layout. A 16:9 backdrop in a
    /// 393pt hero reported roughly 484pt of width, and that width propagated up
    /// through the ZStack into the scroll content — the whole detail page laid
    /// out wider than the screen, clipped, with no way to reach what fell off the
    /// right edge. An overlay is sized by its parent and never feeds size back.
    @ViewBuilder
    var backdropWash: some View {
        if let urlStr = details?.backdropUrl, let url = URL(string: urlStr) {
            CachedAsyncImage(url: url) { phase in
                switch phase {
                case .success(let img):
                    Color.clear
                        .overlay { img.resizable().scaledToFill() }
                        .clipped()
                        .blur(radius: 30, opaque: true)
                        .opacity(0.5)
                        .overlay(
                            LinearGradient(
                                colors: [.clear, Color.mkBackground.opacity(0.7), Color.mkBackground],
                                startPoint: .top, endPoint: .bottom
                            )
                        )
                default:
                    Color.clear
                }
            }
            .frame(height: Self.heroHeight)
            .clipped()
            .allowsHitTesting(false)
        }
    }

    var heroPoster: some View {
        Group {
            if let urlStr = movie.posterUrl, let url = URL(string: urlStr) {
                CachedAsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let img): img.resizable().scaledToFill()
                    default: Color.mkSurface
                    }
                }
            } else {
                ZStack {
                    Color.mkSurface
                    Image(systemName: "film").font(.title).foregroundColor(.mkMuted.opacity(0.4))
                }
            }
        }
        .frame(width: 104, height: 156)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(Color.mkStrongHairline, lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.5), radius: 16, x: 0, y: 12)
    }

    var heroMetaLine: some View {
        HStack(spacing: 6) {
            Text(movie.mediaType == "tv" ? "SERIES" : "FILM")
                .font(.caption2.weight(.bold))
                .kerning(0.4)
                .foregroundColor(movie.kind.accent)
            if let y = movie.year {
                MetaDot()
                Text(String(y))
                    .font(.caption2.weight(.semibold))
                    .foregroundColor(.mkMuted)
            }
            if let runtime = details?.runtime, runtime > 0 {
                MetaDot()
                Text("\(runtime / 60)h \(runtime % 60)m")
                    .font(.caption2.weight(.semibold))
                    .foregroundColor(.mkMuted)
            } else if let seasons = details?.numberOfSeasons, seasons > 0 {
                MetaDot()
                Text("\(seasons) season\(seasons == 1 ? "" : "s")")
                    .font(.caption2.weight(.semibold))
                    .foregroundColor(.mkMuted)
            }
            Spacer(minLength: 0)
        }
    }

    // MARK: Sections

    @ViewBuilder
    func sectionBlock<Content: View>(_ label: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(label.uppercased())
                .font(.caption2.weight(.bold))
                .kerning(1.2)
                .foregroundColor(.mkMuted)
            content()
        }
    }

    /// Services as rows with a real logo, not as tiny text pills — this is the
    /// answer the screen is here to give.
    @ViewBuilder
    func serviceGrid(_ providers: [String]) -> some View {
        FlowRow(spacing: 8) {
            ForEach(providers.prefix(6), id: \.self) { name in
                HStack(spacing: 9) {
                    ProviderMark(name: name, size: 26)
                    Text(name)
                        .font(.footnote.weight(.semibold))
                        .foregroundColor(.mkText)
                        .lineLimit(1)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 11)
                .background(Color.mkCard, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(Color.mkBorder, lineWidth: 1)
                )
            }
        }
    }

    // MARK: Action bar

    /// Both primary actions in one floating glass bar, in thumb reach. They used
    /// to sit in the navigation bar, at the far end of a one-handed stretch.
    var actionBar: some View {
        GlassEffectContainer {
            HStack(spacing: 6) {
                // Series only. Three capsules is the most this bar can hold at a
                // readable size, which is why the labels here are one word.
                if isTV {
                    Button { Task { await toggleCurrentlyWatching() } } label: {
                        HStack(spacing: 8) {
                            if isTogglingCurrent {
                                ProgressView().scaleEffect(0.7).tint(.orange)
                            } else {
                                Image(systemName: isCurrentlyWatching ? "play.tv.fill" : "play.tv")
                                    .font(.callout.weight(.semibold))
                                    .contentTransition(.symbolEffect(.replace))
                            }
                            Text("Watching")
                                .font(.footnote.weight(.semibold))
                        }
                        .foregroundColor(isCurrentlyWatching ? .orange : .mkText)
                        .frame(maxWidth: .infinity)
                        .frame(height: 46)
                        .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .disabled(isTogglingCurrent)
                    .glassEffect(
                        isCurrentlyWatching ? .regular.tint(Color.orange.opacity(0.5)).interactive() : .clear,
                        in: Capsule()
                    )
                    .accessibilityLabel(isCurrentlyWatching ? "Stop currently watching" : "Currently watching")
                    .sensoryFeedback(.success, trigger: isCurrentlyWatching)
                }

                Button { Task { await toggleWatchlist() } } label: {
                    HStack(spacing: 8) {
                        if isTogglingWatchlist {
                            ProgressView().scaleEffect(0.7).tint(.mkText)
                        } else {
                            Image(systemName: isWatchlisted ? "bookmark.fill" : "bookmark")
                                .font(.callout.weight(.semibold))
                                .contentTransition(.symbolEffect(.replace))
                        }
                        Text(isWatchlisted ? "On Watchlist" : "Watchlist")
                            .font(.footnote.weight(.semibold))
                    }
                    .foregroundColor(.mkText)
                    .frame(maxWidth: .infinity)
                    .frame(height: 46)
                    .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .disabled(isTogglingWatchlist)
                .glassEffect(
                    isWatchlisted ? .regular.tint(Color.mkAccent).interactive() : .clear,
                    in: Capsule()
                )
                .sensoryFeedback(.success, trigger: isWatchlisted)

                Button { Task { await toggleWatched() } } label: {
                    HStack(spacing: 8) {
                        if isTogglingWatched {
                            ProgressView().scaleEffect(0.7).tint(.green)
                        } else {
                            Image(systemName: isWatched ? "checkmark.circle.fill" : "circle")
                                .font(.callout.weight(.semibold))
                                .contentTransition(.symbolEffect(.replace))
                        }
                        Text(isWatched ? "Watched" : "Mark Watched")
                            .font(.footnote.weight(.semibold))
                    }
                    .foregroundColor(isWatched ? .green : .mkText)
                    .frame(maxWidth: .infinity)
                    .frame(height: 46)
                    .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .disabled(isTogglingWatched)
                .glassEffect(
                    isWatched ? .regular.tint(Color.green.opacity(0.5)).interactive() : .clear,
                    in: Capsule()
                )
                .sensoryFeedback(.success, trigger: isWatched)
            }
            .padding(7)
        }
        .glassEffect(.regular, in: Capsule())
        .padding(.horizontal, 20)
        .padding(.bottom, 24)
    }

    @MainActor func toggleCurrentlyWatching() async {
        isTogglingCurrent = true
        do {
            if isCurrentlyWatching {
                let _: ToggleWatchedResponse = try await APIService.shared.delete(
                    "/currently-watching/\(movie.id)", token: app.token
                )
                app.setCurrentlyWatching(movie.id, on: false)
            } else {
                let body: [String: String] = ["itemId": movie.id, "title": movie.title,
                                              "posterUrl": movie.posterUrl ?? ""]
                let _: ToggleWatchedResponse = try await APIService.shared.post(
                    "/currently-watching", body: body, token: app.token
                )
                app.setCurrentlyWatching(movie.id, on: true)
            }
        } catch {
            // Silently swallowing this left the button looking untouched while
            // the change never reached the server.
            app.report(error: error, whileTrying: "Updating Currently Watching")
        }
        isTogglingCurrent = false
    }

    // Reusable labeled section block
    @ViewBuilder
    func detailRow<Content: View>(icon: String, label: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(label, systemImage: icon)
                .font(.footnote.weight(.semibold)).foregroundColor(.mkAccent)
            content()
        }
    }

    /// Fixed mid-tones, matching the pair the analytics page uses for above and
    /// below average. `.green` and `.red` sit outside every palette here and
    /// read differently on a light ground than a dark one.
    private static let prosTint = Color(hex: "#2E9E6B")
    private static let consTint = Color(hex: "#C4562F")

    /// Watchmode's contribution: a one-line verdict, the pros and cons, and what
    /// it costs to rent.
    ///
    /// Kept visibly separate from the rest of the sheet, and labelled, because
    /// it is editorial where everything above it is factual — a runtime is a
    /// runtime, but "not for you if…" is somebody's opinion and should not read
    /// as the app's own. Absent entirely when Watchmode has nothing, which for a
    /// small quota is a normal outcome rather than an error worth reporting.
    @ViewBuilder
    func watchmodeSection(_ extras: WatchmodeExtras) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Image(systemName: "text.quote").font(.caption).foregroundColor(.mkAccent)
                Text("What people say").font(.footnote.weight(.semibold)).foregroundColor(.mkAccent)
                Spacer()
                Text("Watchmode").font(.caption2).foregroundColor(.mkMuted)
            }

            if let verdict = extras.verdict {
                Text(verdict)
                    .font(.footnote).foregroundColor(.mkText)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let pros = extras.pros {
                prosConsRow(icon: "hand.thumbsup.fill", text: pros, tint: Self.prosTint)
            }
            if let cons = extras.cons {
                prosConsRow(icon: "hand.thumbsdown.fill", text: cons, tint: Self.consTint)
            }

            if let certificate = extras.certificate {
                HStack(spacing: 6) {
                    Text(certificate)
                        .font(.caption2.weight(.bold))
                        .foregroundColor(.mkText)
                        .padding(.horizontal, 7).padding(.vertical, 3)
                        .overlay(
                            RoundedRectangle(cornerRadius: 4, style: .continuous)
                                .stroke(Color.mkBorder, lineWidth: 1)
                        )
                    Text("rating").font(.caption2).foregroundColor(.mkMuted)
                }
            }

            if extras.rent != nil || extras.buy != nil {
                HStack(spacing: 14) {
                    if let rent = extras.rent {
                        priceChip(label: "Rent", price: rent)
                    }
                    if let buy = extras.buy {
                        priceChip(label: "Buy", price: buy)
                    }
                }
                .padding(.top, 2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Color.mkSurface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .padding(.top, 4)
    }

    private func prosConsRow(icon: String, text: String, tint: Color) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: icon).font(.caption2).foregroundColor(tint)
                .padding(.top, 2)
            Text(text)
                .font(.caption).foregroundColor(.mkMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    /// The cheapest price in the region, with whoever is charging it — a number
    /// with no storefront beside it is not something anyone can act on.
    private func priceChip(label: String, price: WatchmodePrice) -> some View {
        HStack(spacing: 5) {
            Text(label.uppercased())
                .font(.caption2.weight(.bold)).tracking(0.5).foregroundColor(.mkMuted)
            Text(price.label)
                .font(.footnote.weight(.semibold)).foregroundColor(.mkText).monospacedDigit()
            Text(price.service)
                .font(.caption2).foregroundColor(.mkMuted).lineLimit(1)
        }
        .padding(.horizontal, 10).padding(.vertical, 6)
        .background(Color.mkAccent.opacity(0.12), in: Capsule())
        .accessibilityLabel("\(label) from \(price.service) for \(price.label)")
    }

    @ViewBuilder
    func extrasSection(_ d: TitleDetails) -> some View {
        // Runtime (movies) or seasons (TV)
        if let runtime = d.runtime, runtime > 0 {
            HStack(spacing: 8) {
                Image(systemName: "clock").foregroundColor(.mkAccent).font(.footnote)
                Text("Runtime").font(.footnote.weight(.semibold)).foregroundColor(.mkMuted)
                Text("\(runtime) min").font(.footnote).foregroundColor(.mkText)
            }
        } else if let seasons = d.numberOfSeasons {
            HStack(spacing: 8) {
                Image(systemName: "tv").foregroundColor(.mkAccent).font(.footnote)
                Text("Seasons").font(.footnote.weight(.semibold)).foregroundColor(.mkMuted)
                Text("\(seasons)").font(.footnote).foregroundColor(.mkText)
            }
        }
        // Director / Creator
        if let directors = d.directors, !directors.isEmpty {
            HStack(spacing: 8) {
                Image(systemName: "camera.fill").foregroundColor(.mkAccent).font(.footnote)
                Text(mediaType == "tv" ? "Creator" : "Director")
                    .font(.footnote.weight(.semibold)).foregroundColor(.mkMuted)
                Text(directors.joined(separator: ", ")).font(.footnote).foregroundColor(.mkText)
            }
        }
        // Cast
        if let cast = d.cast, !cast.isEmpty {
            detailRow(icon: "person.2.fill", label: "Cast") {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .top, spacing: 12) {
                        ForEach(cast.prefix(8)) { CastCell(member: $0) }
                    }
                }
            }
        }
    }

    @MainActor func toggleWatchlist() async {
        isTogglingWatchlist = true
        do {
            if isWatchlisted {
                let _: ToggleWatchedResponse = try await APIService.shared.delete(
                    "/watchlist/\(movie.id)", token: app.token
                )
                app.setWatchlisted(movie.id, on: false)
            } else {
                let body: [String: String] = ["itemId": movie.id, "title": movie.title,
                                               "mediaType": mediaType, "tmdbId": tmdbId,
                                               "posterUrl": movie.posterUrl ?? ""]
                let _: ToggleWatchedResponse = try await APIService.shared.post(
                    "/watchlist", body: body, token: app.token
                )
                app.setWatchlisted(movie.id, on: true)
            }
        } catch {
            // Silently swallowing this left the button looking untouched while
            // the change never reached the server.
            app.report(error: error, whileTrying: "Updating your watchlist")
        }
        isTogglingWatchlist = false
    }

    @MainActor func loadDetails() async {
        isLoadingExtras = true
        do {
            let d: TitleDetails = try await APIService.shared.get(
                "/titles/\(mediaType)/\(tmdbId)/details", token: app.token
            )
            details = d
        } catch {
            detailsError = "Could not load cast & details."
        }
        isLoadingExtras = false
    }

    @MainActor func loadWatched() async {
        guard app.watchedIds.isEmpty else { return }
        do {
            let resp: WatchedListResponse = try await APIService.shared.get("/watched", token: app.token)
            for item in resp.items ?? [] { app.setWatched(item.itemId, watched: true) }
        } catch {
            // Quiet on purpose: this tops up a list the device already holds,
            // and it only runs when that list is empty. A banner here would
            // interrupt someone who has not asked for anything.
        }
    }

    @MainActor func toggleWatched() async {
        isTogglingWatched = true
        do {
            if isWatched {
                let _: ToggleWatchedResponse = try await APIService.shared.delete(
                    "/watched/\(movie.id)", token: app.token
                )
                app.setWatched(movie.id, watched: false)
            } else {
                let body: [String: String] = ["itemId": movie.id, "title": movie.title,
                                               "mediaType": mediaType, "tmdbId": tmdbId,
                                               "posterUrl": movie.posterUrl ?? ""]
                let _: ToggleWatchedResponse = try await APIService.shared.post(
                    "/watched", body: body, token: app.token
                )
                app.setWatched(movie.id, watched: true)
            }
        } catch {
            // Silently swallowing this left the button looking untouched while
            // the change never reached the server.
            app.report(error: error, whileTrying: "Marking watched")
        }
        isTogglingWatched = false
    }

    func buildRatings() -> [MovieCardView.RatingEntry] {
        var out: [MovieCardView.RatingEntry] = []
        if let v = movie.tmdbRating, v > 0 {
            out.append(.init(label: "TMDb", value: String(format: "%.1f", v), logoAsset: "tmdb",
                             color: Color(red: 0.133, green: 0.729, blue: 0.502)))
        }
        if let v = movie.imdbRating, !v.isEmpty, v != "N/A" {
            out.append(.init(label: "IMDb", value: v, logoAsset: "imdb",
                             color: Color(red: 0.945, green: 0.702, blue: 0.102)))
        }
        if let v = movie.rottenTomatoesRating, !v.isEmpty, v != "N/A" {
            let numStr = v.components(separatedBy: CharacterSet.decimalDigits.inverted).joined()
            let pct = Int(numStr) ?? 0
            let fresh = pct >= 60
            out.append(.init(label: "RT", value: "\(pct)%", logoAsset: fresh ? "rt_fresh" : "rt_rotten",
                             color: fresh ? Color(red: 0.98, green: 0.36, blue: 0.22) : Color(red: 0.5, green: 0.7, blue: 0.22)))
        }
        if let v = movie.metacriticRating, !v.isEmpty, v != "N/A" {
            out.append(.init(label: "MC", value: v, logoAsset: "metacritic",
                             color: Color(red: 1.0, green: 0.69, blue: 0.0)))
        }
        return out
    }
}

struct CastCell: View {
    let member: CastMember
    @State private var showPersonMovies = false

    var body: some View {
        Button { showPersonMovies = true } label: {
            VStack(spacing: 5) {
                Group {
                    if let urlStr = member.profileUrl, let url = URL(string: urlStr) {
                        CachedAsyncImage(url: url) { phase in
                            switch phase {
                            case .success(let img): img.resizable().scaledToFill()
                            default: placeholderPerson
                            }
                        }
                    } else { placeholderPerson }
                }
                .frame(width: 64, height: 80)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.mkBorder, lineWidth: 1))
                Text(member.name)
                    .font(.caption2.weight(.semibold))
                    .foregroundColor(.mkText).lineLimit(2).multilineTextAlignment(.center)
                    .frame(width: 64)
                if !member.character.isEmpty {
                    Text(member.character).font(.caption2).foregroundColor(.mkMuted)
                        .lineLimit(1).frame(width: 64)
                }
            }
        }
        .buttonStyle(ScaleButtonStyle())
        .sheet(isPresented: $showPersonMovies) {
            PersonMoviesSheet(person: member)
        }
    }
    var placeholderPerson: some View {
        ZStack {
            Color.mkSurface
            Image(systemName: "person.fill").foregroundColor(.mkMuted.opacity(0.4))
        }
    }
}

// MARK: - Person Movies Sheet

struct PersonMoviesSheet: View {
    let person: CastMember
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var items: [CatalogItem] = []
    @State private var isLoading = true
    @State private var errorMsg: String?

    var body: some View {
        NavigationStack {
            ZStack {
                Color.mkBackground.ignoresSafeArea()
                content
            }
            .navigationTitle(person.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") { dismiss() }.foregroundColor(.mkAccent)
                }
            }
        }
        .task { await load() }
    }

    @ViewBuilder
    private var content: some View {
        if isLoading {
            ProgressView("Loading…").tint(.mkAccent)
        } else if let err = errorMsg {
            Text(err).foregroundColor(.mkMuted).padding()
        } else if items.isEmpty {
            VStack(spacing: 12) {
                // A decorative glyph standing in for a missing screenful, not copy — the
                // sentence beside it is what carries the meaning and scales. Sized to hold
                // the empty state together rather than to be read.
                Image(systemName: "film.slash").font(.system(size: 44)).foregroundColor(.mkMuted)
                Text("No titles found on your streaming services.")
                    .font(.subheadline).foregroundColor(.mkMuted).multilineTextAlignment(.center)
            }.padding()
        } else {
            ScrollView {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 110), spacing: 12)], spacing: 14) {
                    ForEach(items) { item in
                        PersonMovieCell(item: item)
                    }
                }
                .padding(16)
            }
        }
    }

    @MainActor
    func load() async {
        isLoading = true
        do {
            let response: PersonMoviesResponse = try await APIService.shared.get(
                "/titles/person/\(person.id)", token: app.token
            )
            items = response.items
        } catch {
            errorMsg = "Could not load titles."
        }
        isLoading = false
    }
}

private struct PersonMovieCell: View {
    let item: CatalogItem
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            CachedAsyncImage(url: URL(string: item.posterUrl ?? "")) { phase in
                switch phase {
                case .success(let img): img.resizable().scaledToFill()
                default:
                    ZStack {
                        Color.mkSurface
                        Image(systemName: "film").foregroundColor(.mkMuted.opacity(0.4))
                    }
                }
            }
            .frame(width: 110, height: 160)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            Text(item.title)
                .font(.caption2.weight(.semibold))
                .foregroundColor(.mkText).lineLimit(2)
                .frame(width: 110, alignment: .leading)
            if let year = item.year {
                Text(String(year)).font(.caption2).foregroundColor(.mkMuted)
            }
        }
    }
}
