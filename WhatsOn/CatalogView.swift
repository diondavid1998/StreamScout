//
//  CatalogView.swift
//  WhatsOn
//
// Discover: the feed, its filter bar, and the tab bar under it.
//

import SwiftUI

// MARK: - Catalog

struct CatalogView: View {
    enum MainTab: String, CaseIterable, Identifiable {
        case discover
        case watching
        case watched
        case watchlist

        var id: String { rawValue }
        var label: String {
            switch self {
            case .discover: return "Discover"
            case .watching: return "Watching"
            case .watched: return "Watched"
            case .watchlist: return "Watchlist"
            }
        }
        var systemImage: String {
            switch self {
            case .discover: return "safari"
            case .watching: return "play.tv"
            case .watched: return "checkmark.circle"
            case .watchlist: return "bookmark"
            }
        }
        var title: String {
            switch self {
            case .discover: return "Streaming Catalog"
            case .watching: return "Currently Watching"
            case .watched: return "Watched"
            case .watchlist: return "Watchlist"
            }
        }
    }

    private enum Layout {
        // Tab bar is built from: item height (46) + vertical padding (7*2) + bottom clearance (6)
        static let tabItemHeight: CGFloat = 46
        static let tabBarPadding: CGFloat = 7
        static let tabBarBottomClearance: CGFloat = 6
        static let tabBarHeight: CGFloat = tabItemHeight + tabBarPadding * 2 + tabBarBottomClearance
        static let tabBarBottomMargin: CGFloat = 24
        static let feedBottomGap: CGFloat = 16

        static var feedBottomInset: CGFloat {
            tabBarHeight + tabBarBottomMargin + feedBottomGap
        }
    }

    @Environment(AppState.self) private var app
    @State private var mainTab: MainTab = .discover
    @Namespace private var tabGlass
    @State private var movies: [CatalogItem] = []
    @State private var meta: CatalogMeta?
    @State private var isLoading = false
    @State private var errorMsg: String?
    @State private var mediaType    = "all"
    @State private var sortBy       = "popularity"
    @State private var page         = 1
    @State private var totalPages   = 1
    @State private var showSettingsView = false
    @State private var showGenrePicker = false
    @State private var showLanguagePicker = false
    @State private var showYearFilter = false
    @State private var genreFilters: Set<String> = []
    @State private var languageFilters: Set<String> = []
    @State private var yearMin = ""
    @State private var yearMax = ""
    @State private var hideWatched = false
    @State private var watchlistOnly = false
    /// Narrows the watchlist view to titles currently streaming on the user's
    /// services. Mutually exclusive with `watchlistOnly`.
    @State private var streamingWatchlistOnly = false
    @State private var selectedDetail: CatalogItem? = nil
    @State private var pollingTask: Task<Void, Never>?
    @State private var searchText = ""
    @State private var searchResults: [CatalogItem] = []
    @State private var isSearchActive = false
    @State private var isSearchLoading = false
    @State private var searchTask: Task<Void, Never>?
    @State private var showLogoutAlert = false
    @State private var showAnalytics = false

    static let allGenres: [(key: String, label: String)] = [
        ("Action","Action"), ("Adventure","Adventure"), ("Animation","Animation"),
        ("anime","Anime ✦"), ("Comedy","Comedy"), ("Crime","Crime"),
        ("Documentary","Documentary"), ("Drama","Drama"), ("Fantasy","Fantasy"),
        ("Horror","Horror"), ("Mystery","Mystery"), ("Romance","Romance"),
        ("Science Fiction","Sci-Fi"), ("Thriller","Thriller"), ("Western","Western")
    ]

    var body: some View {
        ZStack {
            ambientBackdrop

            VStack(spacing: 0) {
                topBar.padding(.horizontal, 16).padding(.top, 16).padding(.bottom, 10)
                if mainTab == .discover {
                    searchBar
                    if !isSearchActive { filterBar.padding(.bottom, 8) }
                }
                Divider().overlay(Color.mkBorder)

                Group {
                    switch mainTab {
                    case .discover:
                        discoverContent
                    case .watching:
                        CurrentlyWatchingTabView().environment(app)
                    case .watched:
                        WatchedOnlyTabView().environment(app)
                    case .watchlist:
                        WatchlistOnlyTabView().environment(app)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .safeAreaInset(edge: .bottom) {
            dockedTabBar
        }
        .sheet(isPresented: $showSettingsView) {
            SettingsView().environment(app)
        }
        .sheet(isPresented: $showAnalytics) {
            AnalyticsView().environment(app)
        }
        .sheet(isPresented: $showGenrePicker) {
            GenrePickerSheet(selected: $genreFilters) { page = 1; Task { await fetch() } }
        }
        .sheet(isPresented: $showLanguagePicker) {
            LanguagePickerSheet(selected: $languageFilters, available: app.selectedLanguages) {
                page = 1; Task { await fetch() }
            }
        }
        .sheet(isPresented: $showYearFilter) {
            YearFilterSheet(yearMin: $yearMin, yearMax: $yearMax) { page = 1; Task { await fetch() } }
        }
        .sheet(item: $selectedDetail) { movie in
            DetailSheet(movie: movie).environment(app)
        }
        .task {
            // Show the last snapshot first so the feed is never a blank spinner
            // on a cold launch, then refresh over the top.
            seedFromSnapshot()
            if app.selectedPlatforms.isEmpty { await loadPlatforms() }
            if app.selectedPlatforms.isEmpty { showSettingsView = true; return }
            await fetch()
            startPollingIfNeeded()
        }
        .onChange(of: mainTab) { _, tab in
            if tab != .discover {
                isSearchActive = false
                searchTask?.cancel()
                pollingTask?.cancel()
            } else if meta?.refreshing == true {
                startPollingIfNeeded()
            }
        }
        .onChange(of: showSettingsView) { _, open in
            if !open && mainTab == .discover { page = 1; Task { await fetch() } }
        }
        .sensoryFeedback(.selection, trigger: mainTab)
        .onDisappear { pollingTask?.cancel(); searchTask?.cancel() }
        .alert("Log Out", isPresented: $showLogoutAlert) {
            Button("Log Out", role: .destructive) { app.logout() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Are you sure you want to log out?")
        }
    }

    var ambientBackdrop: some View {
        MeshGradient(
            width: 3,
            height: 3,
            points: [
                [0.0, 0.0], [0.5, 0.0], [1.0, 0.0],
                [0.0, 0.5], [0.5, 0.5], [1.0, 0.5],
                [0.0, 1.0], [0.5, 1.0], [1.0, 1.0]
            ],
            colors: [
                .mkMeshTopLeading,    .mkMeshTop,    .mkMeshTopTrailing,
                .mkMeshLeading,       .mkMeshCenter, .mkMeshTrailing,
                .mkMeshBottomLeading, .mkMeshBottom, .mkMeshBottomTrailing
            ]
        )
        .ignoresSafeArea()
        .allowsHitTesting(false)
    }

    // MARK: Sub-views

    var discoverContent: some View {
        Group {
            if isSearchActive {
                searchContent
            } else if movies.isEmpty && (isLoading || meta?.refreshing == true) {
                // Spinner only when there is genuinely nothing to show. A seeded
                // snapshot or a previous page stays on screen while a refresh
                // runs — the toolbar's spinning refresh icon signals the reload.
                VStack(spacing: 10) {
                    Spacer()
                    ProgressView().tint(.mkAccent)
                    Text(meta?.refreshing == true && !isLoading
                         ? "Building your catalog… check back in a moment."
                         : "Loading catalog…")
                        .font(.caption).foregroundColor(.mkMuted)
                        .multilineTextAlignment(.center).padding(.horizontal, 40)
                    Spacer()
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if movies.isEmpty && !isLoading {
                if let err = errorMsg {
                    VStack(spacing: 12) {
                        Spacer()
                        // A decorative glyph standing in for a missing screenful, not copy — the
                        // sentence beside it is what carries the meaning and scales. Sized to hold
                        // the empty state together rather than to be read.
                        Image(systemName: "wifi.exclamationmark")
                            .font(.system(size: 40)).foregroundColor(.mkAccent)
                        Text("Couldn't load titles")
                            .font(.title3).bold().foregroundColor(.mkMuted)
                        Text(err).font(.subheadline).foregroundColor(.mkMuted.opacity(0.7))
                            .multilineTextAlignment(.center).padding(.horizontal, 40)
                        MKButton(label: "Retry", icon: "arrow.clockwise") { Task { await fetch() } }
                            .frame(maxWidth: 180).padding(.top, 4)
                        Spacer()
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    emptyState
                }
            } else {
                ScrollView {
                    LazyVStack(spacing: 12) {
                        if let m = meta { metaBanner(m).padding(.horizontal, 16) }
                        ForEach(movies) { movie in
                            MovieCardView(movie: movie, onTap: { selectedDetail = movie })
                                .padding(.horizontal, 16)
                        }
                        if totalPages > 1 { paginationBar.padding(.horizontal, 16).padding(.bottom, 24) }
                    }
                    .padding(.top, 12)
                    .padding(.bottom, Layout.feedBottomInset)
                }
                .scrollEdgeEffectStyle(.soft, for: .top)
                .scrollDismissesKeyboard(.immediately)
            }
        }
    }

    var topBar: some View {
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text("🎬 \(Brand.wordmark)")
                    .font(.caption2.weight(.semibold)).tracking(0.5)
                    .foregroundColor(.mkAccent)
                Text(mainTab.title)
                    .font(.title3.weight(.bold)).foregroundColor(.mkText)
            }
            Spacer()
            if mainTab == .discover {
                IconButton(icon: "arrow.clockwise", spinning: isLoading) { Task { await fetch() } }
            }
            IconButton(icon: "chart.bar.xaxis") { showAnalytics = true }
            IconButton(icon: "gearshape.fill") { showSettingsView = true }
            IconButton(icon: "rectangle.portrait.and.arrow.right") { showLogoutAlert = true }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    /// A floating pill tab bar. The capsule itself is the glass surface —
    /// no full-width plate behind it, so nothing balloons the safe-area inset.
    var dockedTabBar: some View {
        GlassEffectContainer {
            HStack(spacing: 3) {
                ForEach(MainTab.allCases) { tab in
                    let isSelected = mainTab == tab
                    Button {
                        withAnimation(.spring(response: 0.35, dampingFraction: 0.78)) {
                            mainTab = tab
                        }
                    } label: {
                        HStack(spacing: 7) {
                            Image(systemName: tab.systemImage)
                                .font(.body.weight(.medium))
                            if isSelected {
                                Text(tab.label)
                                    .font(.footnote.weight(.semibold))
                                    .fixedSize()
                                    .transition(.opacity.combined(with: .blurReplace))
                            }
                        }
                        .foregroundStyle(isSelected ? Color.mkText : Color.mkMuted)
                        .frame(height: Layout.tabItemHeight)
                        .frame(minWidth: 56)
                        .padding(.horizontal, isSelected ? 16 : 8)
                        .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .glassEffect(
                        isSelected ? .regular.tint(Color.mkAccent).interactive() : .clear,
                        in: Capsule()
                    )
                    .glassEffectID(tab.id, in: tabGlass)
                }
            }
        }
        .padding(Layout.tabBarPadding)
        // The bar scales with the reader's text setting like everything else,
        // but only so far. Its height is a fixed constant and five tabs have to
        // fit across the screen, so past this the labels would be clipped rather
        // than read — which helps nobody. Everything the bar leads to scales the
        // whole way; this is the one place with a ceiling.
        .dynamicTypeSize(...DynamicTypeSize.xxLarge)
        .glassEffect(.regular, in: Capsule())
        // No .clipShape — glassEffect already shapes the bar, and clipShape
        // kills hit-testing at the rounded ends of outer tabs.
        .padding(.horizontal, 20)
        .padding(.bottom, Layout.tabBarBottomClearance)
    }

    /// One glass rail carrying plain chips, rather than a glass surface holding
    /// chips that are each their own glass. Stacked glass cancels itself out —
    /// the layer stops reading as a single floating control.
    var filterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 4) {
                Menu {
                    ForEach([("tv","TV Shows"),("movie","Movies"),("all","All Titles"),("documentary","Documentary")], id: \.0) { k, l in
                        Button(l) { mediaType = k; page = 1; Task { await fetch() } }
                    }
                } label: {
                    FilterChip(label: mediaTypeLabel, icon: "tv", active: mediaType != "all")
                }
                Menu {
                    // "Just added" leads: it is the only sort that answers a
                    // question the others cannot — what is here now that was not
                    // last time — and the backend has been recording the answer
                    // in `first_seen_at` since long before anything asked for it.
                    ForEach([("recently_added","Just Added"),("popularity","Popularity"),("tmdb","TMDb"),("imdb","IMDb"),("rotten_tomatoes","Rotten Tomatoes"),("metacritic","Metacritic"),("release_date","Release Date"),("title","A–Z")], id: \.0) { k, l in
                        Button(l) { sortBy = k; page = 1; Task { await fetch() } }
                    }
                } label: {
                    FilterChip(label: sortLabel, icon: "arrow.up.arrow.down", active: sortBy != "popularity")
                }
                Button { showGenrePicker = true } label: {
                    FilterChip(
                        label: genreFilters.isEmpty ? "Genres" : "\(genreFilters.count) Genre\(genreFilters.count == 1 ? "" : "s")",
                        icon: "theatermasks", active: !genreFilters.isEmpty
                    )
                }
                .buttonStyle(ScaleButtonStyle())
                Button { showLanguagePicker = true } label: {
                    FilterChip(
                        label: languageFilters.isEmpty ? "Language" : "\(languageFilters.count) Lang\(languageFilters.count == 1 ? "" : "s")",
                        icon: "globe", active: !languageFilters.isEmpty
                    )
                }
                .buttonStyle(ScaleButtonStyle())
                Button { showYearFilter = true } label: {
                    FilterChip(
                        label: (yearMin.isEmpty && yearMax.isEmpty) ? "Year" : "\(yearMin.isEmpty ? "…" : yearMin)–\(yearMax.isEmpty ? "…" : yearMax)",
                        icon: "calendar", active: !yearMin.isEmpty || !yearMax.isEmpty
                    )
                }
                .buttonStyle(ScaleButtonStyle())
                if !app.watchedIds.isEmpty {
                    Button {
                        hideWatched.toggle(); page = 1; Task { await fetch() }
                    } label: {
                        FilterChip(
                            label: hideWatched ? "Hiding Watched" : "Hide Watched",
                            icon: "eye.slash", active: hideWatched, showsChevron: false
                        )
                    }
                    .buttonStyle(ScaleButtonStyle())
                }
                Button {
                    watchlistOnly.toggle()
                    // The two watchlist views are alternatives, not layers.
                    if watchlistOnly { streamingWatchlistOnly = false }
                    page = 1; Task { await fetch() }
                } label: {
                    FilterChip(
                        label: "From Watchlist",
                        icon: "bookmark.fill", active: watchlistOnly, showsChevron: false
                    )
                }
                .buttonStyle(ScaleButtonStyle())
                if !app.selectedPlatforms.isEmpty {
                    Button {
                        streamingWatchlistOnly.toggle()
                        if streamingWatchlistOnly { watchlistOnly = false }
                        page = 1; Task { await fetch() }
                    } label: {
                        FilterChip(
                            label: "Streaming Watchlist",
                            icon: "antenna.radiowaves.left.and.right", active: streamingWatchlistOnly, showsChevron: false
                        )
                    }
                    .buttonStyle(ScaleButtonStyle())
                }
                if !app.selectedPlatforms.isEmpty {
                    HStack(spacing: 5) {
                        Image(systemName: "play.rectangle.on.rectangle").font(.caption2)
                        Text("\(app.selectedPlatforms.count) services").font(.caption.weight(.medium))
                    }
                    .foregroundColor(.mkMuted)
                    .padding(.horizontal, 11).padding(.vertical, 8)
                }
            }
            .padding(6)
        }
        // A rounded rect rather than a capsule: a capsule's corner arc reaches
        // 8.4pt inward at the first chip's top edge, which sits 6pt in — enough
        // to clip its corner and eat the tap target there. Same reason the tab
        // bar below skips clipShape entirely.
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .padding(.horizontal, 16)
    }

    var emptyState: some View {
        VStack(spacing: 14) {
            Spacer()
            if app.selectedPlatforms.isEmpty {
                Image(systemName: "play.rectangle.on.rectangle").font(.system(size: 44)).foregroundColor(.mkMuted)
                Text("No services selected").font(.title3).bold().foregroundColor(.mkMuted)
                Text("Add your streaming services to see what's available to watch.")
                    .font(.subheadline).foregroundColor(.mkMuted.opacity(0.7))
                    .multilineTextAlignment(.center).padding(.horizontal, 40)
                MKButton(label: "Add Services", icon: "plus.circle.fill") { showSettingsView = true }
                    .frame(maxWidth: 220).padding(.top, 4)
            } else {
                Image(systemName: "popcorn").font(.system(size: 44)).foregroundColor(.mkMuted)
                Text("No titles found").font(.title3).bold().foregroundColor(.mkMuted)
                Text("Adjust your filters or add streaming services.")
                    .font(.subheadline).foregroundColor(.mkMuted.opacity(0.7))
                    .multilineTextAlignment(.center).padding(.horizontal, 40)
                MKButton(label: "Edit Services", icon: "gearshape.fill") { showSettingsView = true }
                    .frame(maxWidth: 220).padding(.top, 4)
            }
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    func metaBanner(_ m: CatalogMeta) -> some View {
        HStack {
            Text("\(m.visibleCount ?? movies.count) of \(m.resultCount ?? movies.count) titles")
                .font(.caption).foregroundColor(.mkMuted)
            Spacer()
            if m.refreshing == true {
                Label("Syncing", systemImage: "arrow.triangle.2.circlepath")
                    .font(.caption2).foregroundColor(.mkAccent)
            }
        }
    }

    var paginationBar: some View {
        HStack(spacing: 12) {
            Button { page = max(1, page - 1); Task { await fetch() } } label: {
                Image(systemName: "chevron.left")
                    .frame(width: 40, height: 40)
                    .background(Color.mkSurface)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .foregroundColor(page == 1 ? .mkMuted.opacity(0.35) : .mkText)
            }
            .disabled(page == 1)

            Text("Page \(page) of \(totalPages)")
                .font(.caption).foregroundColor(.mkMuted).frame(maxWidth: .infinity)

            Button { page = min(totalPages, page + 1); Task { await fetch() } } label: {
                Image(systemName: "chevron.right")
                    .frame(width: 40, height: 40)
                    .background(Color.mkSurface)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .foregroundColor(page == totalPages ? .mkMuted.opacity(0.35) : .mkText)
            }
            .disabled(page == totalPages)
        }
    }

    // MARK: Search

    var searchBar: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").foregroundColor(.mkMuted)
            TextField("Search any movie or show…", text: $searchText)
                .foregroundColor(.mkText)
                .autocorrectionDisabled()
                .onChange(of: searchText) { _, text in
                    searchTask?.cancel()
                    guard text.count >= 2 else {
                        if text.isEmpty {
                            searchResults = []
                            isSearchActive = false
                            isSearchLoading = false
                            if meta?.refreshing == true { startPollingIfNeeded() }
                        }
                        return
                    }
                    pollingTask?.cancel()
                    isSearchActive = true
                    isSearchLoading = true
                    let captured = text
                    searchTask = Task {
                        try? await Task.sleep(nanoseconds: 500_000_000)
                        guard !Task.isCancelled else { return }
                        await searchCatalog(captured)
                    }
                }
            if !searchText.isEmpty {
                Button {
                    searchText = ""
                    searchResults = []
                    isSearchActive = false
                    isSearchLoading = false
                    searchTask?.cancel()
                    if meta?.refreshing == true { startPollingIfNeeded() }
                } label: {
                    Image(systemName: "xmark.circle.fill").foregroundColor(.mkMuted)
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .glassSurface(radius: 14)
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
    }

    var searchContent: some View {
        Group {
            if isSearchLoading {
                VStack {
                    Spacer()
                    ProgressView().tint(.mkAccent)
                    Spacer()
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if searchResults.isEmpty {
                VStack(spacing: 8) {
                    Spacer()
                    Image(systemName: "magnifyingglass").font(.system(size: 32)).foregroundColor(.mkMuted.opacity(0.5))
                    Text("No results for \"\(searchText)\"")
                        .font(.subheadline).foregroundColor(.mkMuted)
                    Spacer()
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(spacing: 12) {
                        ForEach(searchResults) { movie in
                            MovieCardView(movie: movie, onTap: { selectedDetail = movie })
                                .padding(.horizontal, 16)
                        }
                    }
                    .padding(.top, 12).padding(.bottom, Layout.feedBottomInset)
                }
                .scrollDismissesKeyboard(.immediately)
            }
        }
    }

    // MARK: Labels

    var mediaTypeLabel: String {
        switch mediaType {
        case "tv": return "TV Shows"; case "movie": return "Movies"
        case "documentary": return "Documentary"; default: return "All Titles"
        }
    }
    var sortLabel: String {
        switch sortBy {
        case "tmdb": return "TMDb"; case "imdb": return "IMDb"
        case "rotten_tomatoes": return "RT Score"; case "metacritic": return "Metacritic"
        case "release_date": return "Release Date"; case "title": return "A–Z"
        case "recently_added": return "Just Added"
        default: return "Popularity"
        }
    }

    // MARK: Networking

    @MainActor func loadPlatforms() async {
        do {
            let resp: PlatformResponse = try await APIService.shared.get("/platforms", token: app.token)
            app.savePlatforms(resp.platforms)
        } catch {
            // Deliberately quiet, and one of the few that should be: this
            // refreshes a selection the device already has on disk, so failing
            // costs nothing the reader can see or act on. Reporting it would
            // put a banner over a screen that is working fine.
        }
    }

    /// The plain first-page feed a cold launch lands on — no filters, no
    /// watchlist scoping. Only this view is snapshotted for offline, because it
    /// is the only one a relaunch starts from.
    private var isDefaultFeedView: Bool {
        page == 1 && genreFilters.isEmpty && languageFilters.isEmpty
            && yearMin.isEmpty && yearMax.isEmpty
            && !hideWatched && !watchlistOnly && !streamingWatchlistOnly
    }

    /// Which default view a snapshot belongs to. The feed is specific to the
    /// user's services, sort and media type, so a snapshot captured under one
    /// set must never seed another.
    private var feedSignature: String {
        let platforms = app.selectedPlatforms.sorted().joined(separator: ",")
        return "\(platforms)|\(sortBy.isEmpty ? "popularity" : sortBy)|\(mediaType.isEmpty ? "all" : mediaType)"
    }

    /// Put the last snapshot on screen immediately, before the network answers
    /// — and leave it there if the network never does. A live fetch overwrites
    /// both the view and the snapshot moments later.
    @MainActor func seedFromSnapshot() {
        guard movies.isEmpty, isDefaultFeedView,
              let data = FeedSnapshot.load(signature: feedSignature),
              let cached = try? JSONDecoder().decode(CatalogResponse.self, from: data),
              !cached.catalog.isEmpty else { return }
        movies = cached.catalog
        meta = cached.meta
        totalPages = cached.meta?.totalPages ?? totalPages
    }

    @MainActor func fetch() async {
        isLoading = true; errorMsg = nil
        var params: [String: String] = [
            "page":      String(page),
            "sortBy":    sortBy.isEmpty ? "popularity" : sortBy,
            "mediaType": mediaType.isEmpty ? "all" : mediaType
        ]
        if !app.selectedPlatforms.isEmpty { params["serviceFilters"] = app.selectedPlatforms.joined(separator: ",") }
        if !genreFilters.isEmpty          { params["genreFilters"]    = genreFilters.joined(separator: ",") }
        if !languageFilters.isEmpty       { params["languageFilters"] = languageFilters.joined(separator: ",") }
        if !yearMin.isEmpty               { params["yearMin"] = yearMin }
        if !yearMax.isEmpty               { params["yearMax"] = yearMax }
        if hideWatched && !app.watchedIds.isEmpty { params["hideWatched"] = "true" }
        if watchlistOnly || streamingWatchlistOnly {
            params["watchlistOnly"] = "true"
            if streamingWatchlistOnly { params["streamingOnly"] = "true" }
        }
        do {
            let fetched: (value: CatalogResponse, data: Data) =
                try await APIService.shared.getWithData("/movies", params: params, token: app.token)
            let resp = fetched.value
            let raw = fetched.data
            if let serverError = resp.error, resp.catalog.isEmpty {
                errorMsg = serverError; isLoading = false; return
            }
            movies     = resp.catalog
            meta       = resp.meta
            totalPages = resp.meta?.totalPages ?? max(1, Int(ceil(Double(resp.meta?.resultCount ?? 0) / 24.0)))
            // Keep the offline snapshot fresh — only for the default view, and
            // only when it actually returned titles, so a blank page never
            // overwrites a good cache.
            if isDefaultFeedView && !resp.catalog.isEmpty {
                FeedSnapshot.save(raw, signature: feedSignature)
            }
            if meta?.refreshing == true { startPollingIfNeeded() }
        } catch APIError.unauthorized {
            app.logout()
        } catch {
            errorMsg = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
        isLoading = false
    }

    @MainActor func searchCatalog(_ query: String) async {
        do {
            let resp: CatalogResponse = try await APIService.shared.get(
                "/search", params: ["q": query], token: app.token
            )
            // Discard if user has already typed something new
            guard query == searchText else { return }
            searchResults = resp.catalog
        } catch APIError.unauthorized {
            app.logout()
        } catch {
            // Only for the query still on screen — an aborted request for text
            // the reader has already typed past is not a failure they care about.
            guard query == searchText else { return }
            app.report(error: error, whileTrying: "Search")
        }
        isSearchLoading = false
    }

    func startPollingIfNeeded() {
        guard meta?.refreshing == true else { return }
        pollingTask?.cancel()
        pollingTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 8_000_000_000)
                guard !Task.isCancelled else { break }
                await fetch()
                if meta?.refreshing != true { break }
            }
        }
    }
}
