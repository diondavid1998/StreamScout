//
//  MovieCardView.swift
//  WhatsOn
//
// One title as it appears in the feed.
//

import SwiftUI

// MARK: - Movie Card

struct MovieCardView: View {
    let movie: CatalogItem
    var onTap: () -> Void = {}
    @Environment(AppState.self) private var app
    @State private var isTogglingWatched = false
    @State private var isTogglingWatchlist = false
    @State private var isTogglingCurrent = false
    /// Dominant color extracted from the poster; nil until the async fetch completes.
    /// It no longer tints the whole card — see `edgeTint`.
    @State private var dominantColor: Color? = nil
    var isTV: Bool { movie.mediaType == "tv" }
    var isWatched: Bool { app.watchedIds.contains(movie.id) }
    var isWatchlisted: Bool { app.watchlistIds.contains(movie.id) }
    var isCurrentlyWatching: Bool { app.currentlyWatchingIds.contains(movie.id) }
    var mediaType: String { movie.mediaType ?? "movie" }
    var tmdbId: String {
        let parts = movie.id.split(separator: "-")
        return parts.count >= 2 ? String(parts.last!) : movie.id
    }

    var body: some View {
        // A tap gesture on the container rather than a Button wrapping it all.
        //
        // The card's content now holds two horizontal ScrollViews — the service
        // bar and the score strip — plus the two toggle buttons. Nesting
        // scrollable and tappable children inside a Button's label makes the
        // outer Button and the inner gestures compete for the same touch, and
        // the card's own tap is the one that loses. A contentShape plus
        // onTapGesture keeps the whole card hittable while letting the real
        // Buttons inside it win their own taps and the scroll views keep their
        // drags.
        HStack(alignment: .top, spacing: 12) {
            posterView
            infoColumn
        }
        .padding(12)
        // Content layer: opaque and identical card to card. Liquid Glass is
        // reserved for the floating layer (tab bar, filter rail, toolbar), so
        // that layer reads as floating instead of blending into the feed.
        .background(Color.mkCard, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(alignment: .top) { edgeTint }
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(Color.mkBorder, lineWidth: 1)
        )
        .contentShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .onTapGesture(perform: onTap)
        // Dropping the Button drops its accessibility traits with it, so put
        // them back explicitly.
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isButton)
        .accessibilityLabel(movie.title)
        .accessibilityHint("Opens details")
        // Seed from cache synchronously (no flicker on re-render after first load)
        .onAppear {
            if let urlString = movie.posterUrl {
                dominantColor = ColorCache.shared.cachedColor(for: urlString)
            }
        }
        // Kick off async fetch; task is re-run only when the posterUrl changes
        .task(id: movie.posterUrl) {
            guard let urlString = movie.posterUrl else { return }
            if let color = await ColorCache.shared.fetchColor(for: urlString) {
                withAnimation(.easeIn(duration: 0.4)) { dominantColor = color }
            }
        }
    }

    /// The poster's dominant color, reduced to a 2pt edge along the top of the card.
    /// One restrained trace of the artwork instead of a full-card wash — a scrolling
    /// list of differently-tinted cards reads as color noise.
    @ViewBuilder
    var edgeTint: some View {
        if let color = dominantColor {
            LinearGradient(
                colors: [color, color.opacity(0)],
                startPoint: .leading,
                endPoint: .trailing
            )
            .frame(height: 2)
            .allowsHitTesting(false)
        }
    }

    // MARK: Poster

    var posterView: some View {
        Group {
            if let urlStr = movie.posterUrl, let url = URL(string: urlStr) {
                CachedAsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let img): img.resizable().scaledToFill()
                    default: posterPlaceholder
                    }
                }
            } else {
                posterPlaceholder
            }
        }
        .frame(width: 96, height: 144)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(Color.mkBorder, lineWidth: 1)
        )
    }

    var posterPlaceholder: some View {
        ZStack {
            Color.mkSurface
            Image(systemName: "film").font(.title2).foregroundColor(.mkMuted.opacity(0.4))
        }
    }

    /// Services get their own row above the scores.
    ///
    /// They used to sit as 13pt marks in the poster's bottom corner, over a
    /// scrim, capped at three with a "+2". At that size a logo is a coloured
    /// smudge — you could tell a title was streaming somewhere but not where,
    /// which is the one question the app exists to answer. Named chips, and the
    /// row scrolls rather than truncating, so a title on six services shows six.
    @ViewBuilder
    var serviceBar: some View {
        let providers = movie.availableOn ?? []
        if !providers.isEmpty {
            ScrollView(.horizontal) {
                HStack(spacing: 6) {
                    ForEach(providers, id: \.self) { name in
                        HStack(spacing: 5) {
                            // The chip's own text carries the name for VoiceOver.
                            ProviderMark(name: name, size: 15)
                                .accessibilityHidden(true)
                            Text(name)
                                .font(.caption2.weight(.semibold))
                                .foregroundColor(.mkText)
                                .lineLimit(1)
                        }
                        .padding(.horizontal, 8)
                        .padding(.vertical, 5)
                        .background(Color.mkSubtleFill, in: Capsule())
                        .overlay(Capsule().stroke(Color.mkHairline, lineWidth: 1))
                        .fixedSize(horizontal: true, vertical: false)
                    }
                }
            }
            .scrollIndicators(.hidden)
            .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.bottom, 7)
        }
    }

    // MARK: Info column

    var infoColumn: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 8) {
                Text(movie.title)
                    .font(.callout.weight(.semibold))
                    .foregroundColor(.mkText)
                    .lineLimit(2)
                    .frame(maxWidth: .infinity, alignment: .leading)
                // Watchlist and watched sit together. The bookmark used to hide in
                // the poster's corner, where it read as decoration.
                HStack(spacing: 6) {
                    // Series only — a film has no next episode, so the control
                    // would toggle a state with nothing to say.
                    if isTV { currentlyWatchingToggleButton }
                    watchlistToggleButton
                    watchedToggleButton
                }
            }

            metaLine
                .padding(.top, 5)

            if let ov = movie.overview, !ov.isEmpty {
                Text(ov)
                    .font(.caption)
                    .foregroundColor(.mkMuted)
                    .lineLimit(3)
                    .padding(.top, 7)
            }

            Spacer(minLength: 8)

            serviceBar

            ScoreStrip(entries: buildRatings())
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Kind, year and genres on one line, separated by dots. Replaces the stack of
    /// four bordered pill rows — and the left accent capsule, which said "film or
    /// series" a second time.
    var metaLine: some View {
        HStack(spacing: 6) {
            Text(isTV ? "SERIES" : "FILM")
                .font(.caption2.weight(.bold))
                .kerning(0.4)
                .foregroundColor(movie.kind.accent)
            if let y = movie.year {
                MetaDot()
                Text(String(y))
                    .font(.caption2.weight(.semibold))
                    .foregroundColor(.mkMuted)
            }
            if let genres = movie.genres, !genres.isEmpty {
                MetaDot()
                Text(genres.prefix(2).joined(separator: " · "))
                    .font(.caption2.weight(.semibold))
                    .foregroundColor(.mkMuted)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
    }

    // MARK: Toggles

    var watchedToggleButton: some View {
        Button { Task { await toggleWatched() } } label: {
            Group {
                if isTogglingWatched {
                    ProgressView().scaleEffect(0.6).tint(.green)
                        .frame(width: 22, height: 22)
                } else {
                    Image(systemName: isWatched ? "checkmark.circle.fill" : "circle")
                        .font(.title2)
                        .foregroundColor(isWatched ? .green : .mkMuted.opacity(0.7))
                        .contentTransition(.symbolEffect(.replace))
                        .symbolEffect(.bounce, value: isWatched)
                }
            }
            .frame(width: 26, height: 26)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(isTogglingWatched)
        .accessibilityLabel(isWatched ? "Remove from watched" : "Mark as watched")
        .sensoryFeedback(.success, trigger: isWatched)
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
        } catch let err as APIError {
            if case .unauthorized = err { app.logout() }
        } catch { }
        isTogglingWatched = false
    }

    var currentlyWatchingToggleButton: some View {
        Button { Task { await toggleCurrentlyWatching() } } label: {
            Group {
                if isTogglingCurrent {
                    ProgressView().scaleEffect(0.6).tint(.orange)
                        .frame(width: 22, height: 22)
                } else {
                    Image(systemName: isCurrentlyWatching ? "play.tv.fill" : "play.tv")
                        .font(.body)
                        .foregroundColor(isCurrentlyWatching ? .orange : .mkMuted.opacity(0.7))
                        .contentTransition(.symbolEffect(.replace))
                        .symbolEffect(.bounce, value: isCurrentlyWatching)
                }
            }
            .frame(width: 26, height: 26)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(isTogglingCurrent)
        .accessibilityLabel(isCurrentlyWatching ? "Stop currently watching" : "Currently watching")
        .sensoryFeedback(.success, trigger: isCurrentlyWatching)
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
        } catch let err as APIError {
            if case .unauthorized = err { app.logout() }
        } catch { }
        isTogglingCurrent = false
    }

    var watchlistToggleButton: some View {
        Button { Task { await toggleWatchlist() } } label: {
            Group {
                if isTogglingWatchlist {
                    ProgressView().scaleEffect(0.6).tint(.mkAccent)
                        .frame(width: 22, height: 22)
                } else {
                    Image(systemName: isWatchlisted ? "bookmark.fill" : "bookmark")
                        .font(.title3)
                        .foregroundColor(isWatchlisted ? .mkAccent : .mkMuted.opacity(0.7))
                        .contentTransition(.symbolEffect(.replace))
                        .symbolEffect(.bounce, value: isWatchlisted)
                }
            }
            .frame(width: 26, height: 26)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(isTogglingWatchlist)
        .accessibilityLabel(isWatchlisted ? "Remove from watchlist" : "Add to watchlist")
        .sensoryFeedback(.success, trigger: isWatchlisted)
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
        } catch let err as APIError {
            if case .unauthorized = err { app.logout() }
        } catch { }
        isTogglingWatchlist = false
    }

    // MARK: Rating builder
    struct RatingEntry {
        let label: String
        let value: String
        let logoAsset: String?
        let color: Color
    }

    func buildRatings() -> [RatingEntry] {
        var out: [RatingEntry] = []
        if let v = movie.tmdbRating, v > 0 {
            out.append(.init(label: "TMDb", value: String(format: "%.1f", v), logoAsset: "tmdb",
                             color: Color(red: 0.133, green: 0.729, blue: 0.502)))
        }
        if let v = movie.imdbRating, !v.isEmpty, v != "N/A" {
            out.append(.init(label: "IMDb", value: v, logoAsset: "imdb",
                             color: Color(red: 0.945, green: 0.702, blue: 0.102)))
        }
        if let v = movie.rottenTomatoesRating, !v.isEmpty, v != "N/A" {
            // Strip any non-numeric suffix (e.g. "75%" or "75% Fresh")
            let numStr = v.components(separatedBy: CharacterSet.decimalDigits.inverted).joined()
            let pct = Int(numStr) ?? 0
            let fresh = pct >= 60
            out.append(.init(label: "RT", value: v.hasPrefix(numStr) ? "\(pct)%" : v,
                             logoAsset: fresh ? "rt_fresh" : "rt_rotten",
                             color: fresh ? Color(red: 0.98, green: 0.36, blue: 0.22) : Color(red: 0.5, green: 0.7, blue: 0.22)))
        }
        if let v = movie.metacriticRating, !v.isEmpty, v != "N/A" {
            out.append(.init(label: "MC", value: v, logoAsset: "metacritic",
                             color: Color(red: 1.0, green: 0.69, blue: 0.0)))
        }
        return out
    }
}
