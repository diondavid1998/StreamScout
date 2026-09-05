//
//  DiscoveryView.swift
//  WhatsOn
//
// Swipe to discover. One title at a time, matched against the taste the diary
// describes. The scoring and its reasoning live on the server; see
// docs/swipe-discovery-spec.md.
//

import SwiftUI

struct DiscoveryView: View {
    @Environment(AppState.self) private var app

    @State private var cards: [DiscoveryCard] = []
    @State private var profile: DiscoveryProfile?
    @State private var isLoading = true
    @State private var exhausted = false

    /// The last swipe, kept so it can be taken back. A mis-swipe on a card that
    /// is gone forever is the most irritating failure this screen has.
    @State private var lastSwiped: DiscoveryCard?

    /// How far the top card has been dragged, and which way it is going.
    @State private var drag: CGSize = .zero
    /// True while a card is animating off screen, so a fast second swipe cannot
    /// throw the card behind it before the first has left.
    @State private var flying = false

    @State private var mediaType = "all"
    @State private var hideWatched = true
    @State private var showFilters = false

    /// Past this, letting go commits the swipe.
    private let commitDistance: CGFloat = 110

    private var top: DiscoveryCard? { cards.first }

    var body: some View {
        VStack(spacing: 0) {
            header
            if isLoading && cards.isEmpty {
                Spacer()
                ProgressView().tint(.mkAccent)
                Spacer()
            } else if let card = top {
                deck(card)
                actionBar
            } else {
                emptyState
            }
        }
        .background(Color.mkBackground.ignoresSafeArea())
        .task { await load() }
        .sheet(isPresented: $showFilters) { filterSheet }
    }

    // MARK: Header

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text("For you").font(.title2.weight(.bold)).foregroundColor(.mkText)
                if let profile {
                    // Says what the suggestions rest on. A queue built from the
                    // crowd must not read as though it were built from you.
                    Text(basisLine(profile))
                        .font(.caption).foregroundColor(.mkMuted)
                }
            }
            Spacer()
            Button { showFilters = true } label: {
                Image(systemName: "line.3.horizontal.decrease.circle")
                    .font(.title3).foregroundColor(.mkAccent)
            }
            .accessibilityLabel("Filters")
        }
        .padding(.horizontal, 20).padding(.top, 8).padding(.bottom, 14)
    }

    private func basisLine(_ p: DiscoveryProfile) -> String {
        switch p.basis {
        case "diary":   "from your \(p.ratedFilms) rated films"
        case "blended": "from your \(p.ratedFilms) rated films, and what others rate highly"
        default:        "highly rated on your services — import a diary to make these yours"
        }
    }

    // MARK: The deck

    private func deck(_ card: DiscoveryCard) -> some View {
        ZStack {
            // The one behind, so the deck has depth and the next card is never
            // a blank while it loads.
            if cards.count > 1 {
                DiscoveryCardView(card: cards[1], drag: .zero)
                    .scaleEffect(0.94).offset(y: 14).opacity(0.55)
                    .allowsHitTesting(false)
            }
            DiscoveryCardView(card: card, drag: drag)
                .offset(x: drag.width, y: drag.height * 0.35)
                .rotationEffect(.degrees(Double(drag.width / 22)))
                .allowsHitTesting(!flying)
                .gesture(
                    DragGesture()
                        .onChanged { if !flying { drag = $0.translation } }
                        .onEnded { value in
                            if abs(value.translation.width) > commitDistance {
                                commit(value.translation.width > 0 ? "right" : "left")
                            } else {
                                withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) { drag = .zero }
                            }
                        }
                )
        }
        .padding(.horizontal, 18)
        .frame(maxHeight: .infinity)
    }

    // MARK: Actions

    /// Buttons as well as the gesture, always.
    ///
    /// Swipe as the *only* way through fails anyone who cannot make the
    /// gesture, and there is no reason for it to be the only way.
    private var actionBar: some View {
        HStack(spacing: 22) {
            circleButton("xmark", tint: Color(hex: "#C4562F"), label: "Pass") { commit("left") }

            Button {
                Task { await undo() }
            } label: {
                Image(systemName: "arrow.uturn.backward")
                    .font(.callout.weight(.semibold))
                    .foregroundColor(lastSwiped == nil ? .mkMuted.opacity(0.4) : .mkMuted)
                    .frame(width: 44, height: 44)
                    .background(Color.mkSurface, in: Circle())
            }
            .buttonStyle(.plain)
            .disabled(lastSwiped == nil)
            .accessibilityLabel("Undo last swipe")

            circleButton("heart.fill", tint: Color(hex: "#2E9E6B"), label: "Save") { commit("right") }
        }
        .padding(.top, 16).padding(.bottom, 22)
    }

    private func circleButton(
        _ icon: String, tint: Color, label: String, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.title3.weight(.semibold))
                .foregroundColor(tint)
                .frame(width: 62, height: 62)
                .background(Color.mkSurface, in: Circle())
                .overlay(Circle().stroke(tint.opacity(0.35), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private var emptyState: some View {
        VStack(spacing: 14) {
            Spacer()
            Image(systemName: "sparkles.rectangle.stack")
                .font(.system(size: 44)).foregroundColor(.mkMuted)
            Text(exhausted ? "That's everything for now" : "Nothing to suggest yet")
                .font(.title3).bold().foregroundColor(.mkText)
            // Says what would widen it, rather than leaving a dead end.
            Text(hideWatched
                 ? "Try showing films you have already seen, adding a service, or importing your Letterboxd diary."
                 : "Add a service in Settings, or import your Letterboxd diary to make these personal.")
                .font(.subheadline).foregroundColor(.mkMuted)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 40)
            Button("Start again") { Task { await load(reset: true) } }
                .font(.subheadline.weight(.semibold)).foregroundColor(.mkAccent)
                .padding(.top, 4)
            Spacer()
        }
    }

    private var filterSheet: some View {
        NavigationStack {
            List {
                Section {
                    Picker("Show", selection: $mediaType) {
                        Text("Everything").tag("all")
                        Text("Films").tag("movie")
                        Text("TV").tag("tv")
                    }
                    Toggle("Hide what I've seen", isOn: $hideWatched)
                } footer: {
                    Text("Hiding covers your watched list, your watchlist and anything in an imported diary.")
                }
            }
            .navigationTitle("Filters")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        showFilters = false
                        Task { await load(reset: true) }
                    }
                }
            }
        }
        .presentationDetents([.height(260)])
    }

    // MARK: Networking

    @MainActor private func load(reset: Bool = false) async {
        if reset { cards = []; lastSwiped = nil }
        isLoading = cards.isEmpty
        do {
            var params = ["mediaType": mediaType, "hideWatched": hideWatched ? "true" : "false"]
            params["limit"] = "20"
            let response: DiscoveryResponse = try await APIService.shared.get(
                "/discovery", params: params, token: app.token
            )
            cards = response.cards
            profile = response.profile
            exhausted = response.exhausted
        } catch {
            app.report(error: error, whileTrying: "Finding suggestions")
        }
        isLoading = false
    }

    /// Take the top card off and tell the server, optimistically.
    ///
    /// The card leaves immediately rather than after the round trip: waiting on
    /// the network to animate a swipe makes the whole screen feel broken on a
    /// slow connection. If the call fails the banner says so and the undo
    /// button is right there.
    @MainActor private func commit(_ direction: String) {
        guard let card = top else { return }

        // Throw the card off, then take it out of the deck once it has gone.
        // Removing it in the same pass would cancel the animation before a
        // frame of it drew, and the card would simply vanish — which reads as a
        // glitch rather than as a swipe. `flying` keeps the gesture from
        // starting a second swipe while the first is still leaving.
        guard !flying else { return }
        flying = true
        withAnimation(.easeOut(duration: 0.24)) {
            drag = CGSize(width: direction == "right" ? 700 : -700, height: 0)
        }

        if direction == "right" { app.setWatchlisted(card.itemId, on: true) }

        Task { @MainActor in
            try? await Task.sleep(for: .seconds(0.24))
            if !cards.isEmpty { cards.removeFirst() }
            lastSwiped = card
            drag = .zero
            flying = false
            // Top up before the deck runs dry, so there is no visible stall.
            if cards.count <= 3 { await load() }
        }

        Task {
            do {
                let _: GenericResponse = try await APIService.shared.post(
                    "/discovery/swipe",
                    body: [
                        "itemId": card.itemId,
                        "direction": direction,
                        "genres": card.genres,
                        "mediaType": card.mediaType ?? "movie",
                        "title": card.title,
                        "posterUrl": card.posterUrl ?? "",
                    ],
                    token: app.token
                )
            } catch {
                app.report(error: error, whileTrying: direction == "right" ? "Saving that" : "Passing on that")
            }
        }
    }

    @MainActor private func undo() async {
        guard let card = lastSwiped else { return }
        lastSwiped = nil
        cards.insert(card, at: 0)
        app.setWatchlisted(card.itemId, on: false)
        do {
            let _: GenericResponse = try await APIService.shared.delete(
                "/discovery/swipe/\(card.itemId)", token: app.token
            )
        } catch {
            app.report(error: error, whileTrying: "Undoing that")
        }
    }
}

// MARK: - One card

private struct DiscoveryCardView: View {
    let card: DiscoveryCard
    let drag: CGSize

    /// How strongly to show the pass/save overlay, from how far it has moved.
    private var verdict: (text: String, tint: Color, opacity: Double)? {
        let progress = min(1, abs(drag.width) / 110)
        guard progress > 0.12 else { return nil }
        return drag.width > 0
            ? ("SAVE", Color(hex: "#2E9E6B"), progress)
            : ("PASS", Color(hex: "#C4562F"), progress)
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            poster
            gradientScrim
            details
            if let verdict { stamp(verdict) }
        }
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .stroke(Color.mkStrongHairline, lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.25), radius: 18, y: 8)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityText)
    }

    private var accessibilityText: String {
        var parts = [card.title]
        if let year = card.year { parts.append(String(year)) }
        parts.append(contentsOf: card.because.map { $0.value })
        return parts.joined(separator: ", ")
    }

    private var poster: some View {
        Group {
            if let urlString = card.posterUrl, let url = URL(string: urlString) {
                CachedAsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image): image.resizable().scaledToFill()
                    default: Color.mkSurface
                    }
                }
            } else {
                Color.mkSurface
                    .overlay(Image(systemName: "film").font(.largeTitle).foregroundColor(.mkMuted))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    /// Dark enough at the foot for the copy to read over any artwork.
    private var gradientScrim: some View {
        LinearGradient(
            colors: [.clear, .black.opacity(0.35), .black.opacity(0.88)],
            startPoint: .center, endPoint: .bottom
        )
    }

    private var details: some View {
        VStack(alignment: .leading, spacing: 9) {
            if card.exploration {
                Text("OUTSIDE YOUR USUAL")
                    .font(.caption2.weight(.bold)).tracking(0.8)
                    .foregroundColor(.white)
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(Color.mkAccent.opacity(0.85), in: Capsule())
            }

            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(card.title)
                    .font(.title2.weight(.bold)).foregroundColor(.white)
                    .lineLimit(2).fixedSize(horizontal: false, vertical: true)
                if let year = card.year {
                    Text(String(year)).font(.subheadline).foregroundColor(.white.opacity(0.7))
                        .monospacedDigit()
                }
            }

            if !card.genres.isEmpty {
                Text(card.genres.prefix(3).joined(separator: " · "))
                    .font(.caption).foregroundColor(.white.opacity(0.75))
            }

            // The reason. This is the difference between a recommendation and a
            // slot machine, so it sits with the title rather than behind a tap.
            ForEach(card.because.prefix(2)) { reason in
                HStack(alignment: .top, spacing: 6) {
                    Image(systemName: reason.kind == "exploration" ? "shuffle" : "sparkle")
                        .font(.caption2).foregroundColor(.mkAccent).padding(.top, 2)
                    Text(reasonText(reason))
                        .font(.caption).foregroundColor(.white.opacity(0.9))
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            if !card.availableOn.isEmpty {
                Text("On \(card.availableOn.prefix(3).joined(separator: ", "))")
                    .font(.caption2).foregroundColor(.white.opacity(0.65))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
    }

    private func reasonText(_ reason: DiscoveryReason) -> String {
        guard let detail = reason.detail, !detail.isEmpty else { return reason.value }
        return "\(reason.value) — \(detail)"
    }

    private func stamp(_ verdict: (text: String, tint: Color, opacity: Double)) -> some View {
        Text(verdict.text)
            .font(.title.weight(.heavy))
            .foregroundColor(verdict.tint)
            .padding(.horizontal, 14).padding(.vertical, 7)
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(verdict.tint, lineWidth: 4)
            )
            .rotationEffect(.degrees(drag.width > 0 ? -14 : 14))
            .opacity(verdict.opacity)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .padding(.top, 40)
            .allowsHitTesting(false)
    }
}
