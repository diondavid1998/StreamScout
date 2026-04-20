//
//  ContentView.swift
//  StreamScore
//
//  Created by Dion David on 4/7/26.
//

import SwiftUI

// MARK: - App State

@MainActor
final class AppState: ObservableObject {
    enum Page { case loading, auth, platforms, catalog }

    @Published var page: Page = .loading
    @Published var token: String = ""
    @Published var username: String = ""
    @Published var selectedPlatforms: [String] = []

    private let tokenKey    = "mk_token"
    private let usernameKey = "mk_username"
    private let platformsKey = "mk_platforms"

    init() {
        token    = UserDefaults.standard.string(forKey: tokenKey)?.trimmingCharacters(in: .whitespaces) ?? ""
        username = UserDefaults.standard.string(forKey: usernameKey) ?? ""
        selectedPlatforms = UserDefaults.standard.stringArray(forKey: platformsKey) ?? []
        page = token.isEmpty ? .auth : .catalog
    }

    func saveSession(token: String, username: String, isNewUser: Bool = false) {
        self.token    = token.trimmingCharacters(in: .whitespaces)
        self.username = username
        UserDefaults.standard.set(self.token, forKey: tokenKey)
        UserDefaults.standard.set(username,   forKey: usernameKey)
        // New users go through platform setup first
        page = isNewUser ? .platforms : .catalog
    }

    func savePlatforms(_ platforms: [String]) {
        selectedPlatforms = platforms
        UserDefaults.standard.set(platforms, forKey: platformsKey)
    }

    func logout() {
        token = ""; username = ""; selectedPlatforms = []
        UserDefaults.standard.removeObject(forKey: tokenKey)
        UserDefaults.standard.removeObject(forKey: usernameKey)
        UserDefaults.standard.removeObject(forKey: platformsKey)
        page = .auth
    }
}

// MARK: - Root Router

struct ContentView: View {
    @StateObject private var app = AppState()

    var body: some View {
        ZStack {
            Color.mkBackground.ignoresSafeArea()
            switch app.page {
            case .loading:   LoadingView()
            case .auth:      AuthView()
            case .platforms: PlatformsView()
            case .catalog:   CatalogView()
            }
        }
        .environmentObject(app)
    }
}

// MARK: - Loading

struct LoadingView: View {
    var body: some View {
        VStack(spacing: 16) {
            Image("StreamScoreLogo")
                .resizable()
                .scaledToFit()
                .frame(width: 100, height: 100)
                .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                .shadow(color: .mkAccent.opacity(0.4), radius: 12, x: 0, y: 4)
            Text("StreamScore")
                .font(.system(size: 30, weight: .bold, design: .rounded))
                .foregroundStyle(LinearGradient(colors: [.mkAccent, .mkAccentAlt], startPoint: .leading, endPoint: .trailing))
            ProgressView().tint(.mkAccent).padding(.top, 8)
        }
    }
}

// MARK: - Auth

struct AuthView: View {
    @EnvironmentObject var app: AppState

    enum Mode: CaseIterable { case login, register }
    @State private var mode: Mode = .login
    @State private var username = ""
    @State private var password = ""
    @State private var isLoading = false
    @State private var errorMsg: String?

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                // Hero
                VStack(spacing: 10) {
                    Image("StreamScoreLogo")
                        .resizable()
                        .scaledToFit()
                        .frame(width: 90, height: 90)
                        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                        .shadow(color: .mkAccent.opacity(0.45), radius: 14, x: 0, y: 6)
                        .padding(.top, 60)
                    Text("StreamScore")
                        .font(.system(size: 34, weight: .bold, design: .rounded))
                        .foregroundStyle(
                            LinearGradient(colors: [.mkAccent, .mkAccentAlt], startPoint: .leading, endPoint: .trailing)
                        )
                    Text("Your streaming catalog, unified.")
                        .font(.subheadline)
                        .foregroundColor(.mkMuted)
                        .padding(.bottom, 36)
                }

                // Card
                VStack(spacing: 18) {
                    // Mode toggle
                    HStack(spacing: 0) {
                        ForEach(Mode.allCases, id: \.self) { m in
                            Button {
                                withAnimation(.spring(duration: 0.22)) { mode = m; errorMsg = nil }
                            } label: {
                                Text(m == .login ? "Sign In" : "Register")
                                    .font(.system(size: 14, weight: .semibold))
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 10)
                                    .background(mode == m ? Color.mkAccent : Color.clear)
                                    .foregroundColor(mode == m ? .white : .mkMuted)
                                    .clipShape(RoundedRectangle(cornerRadius: 10))
                            }
                        }
                    }
                    .padding(4)
                    .background(Color.mkBackground)
                    .clipShape(RoundedRectangle(cornerRadius: 13))

                    MKTextField(placeholder: "Username", text: $username, icon: "person.fill")
                    MKTextField(placeholder: "Password", text: $password, icon: "lock.fill", isSecure: true)

                    if let err = errorMsg {
                        Text(err)
                            .font(.caption)
                            .foregroundColor(.mkAccent)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 4)
                    }

                    MKButton(
                        label: isLoading ? "Working…" : (mode == .login ? "Sign In" : "Create Account"),
                        icon: mode == .login ? "arrow.right.circle.fill" : "person.badge.plus",
                        isLoading: isLoading
                    ) { Task { await authenticate() } }
                }
                .padding(24)
                .background(Color.mkSurface)
                .clipShape(RoundedRectangle(cornerRadius: 24))
                .overlay(RoundedRectangle(cornerRadius: 24).stroke(Color.mkBorder, lineWidth: 1))
                .padding(.horizontal, 20)
                .padding(.bottom, 40)
            }
        }
        .scrollBounceBasedOnSize()
    }

    func authenticate() async {
        let trimmedUser = username.trimmingCharacters(in: .whitespaces)
        guard !trimmedUser.isEmpty, !password.isEmpty else {
            errorMsg = "Please fill in both fields."; return
        }
        guard trimmedUser.count >= 3 else {
            errorMsg = "Username must be at least 3 characters."; return
        }
        isLoading = true; errorMsg = nil
        do {
            let resp: AuthResponse = try await APIService.shared.post(
                mode == .login ? "/login" : "/register",
                body: ["username": trimmedUser, "password": password]
            )
            if let t = resp.token {
                app.saveSession(token: t, username: trimmedUser, isNewUser: mode == .register)
            } else {
                errorMsg = resp.error ?? "Authentication failed."
            }
        } catch {
            errorMsg = (error as? APIError)?.errorDescription ?? "Network error. Is the backend running?"
        }
        isLoading = false
    }
}

// MARK: - Platforms

struct PlatformsView: View {
    @EnvironmentObject var app: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var selected: Set<String> = []
    @State private var isLoading = true
    @State private var isSaving  = false
    @State private var errorMsg: String?

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 12), count: 4)

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack(alignment: .center) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("STREAMING SETUP")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(.mkAccent)
                        .kerning(1.4)
                    Text(app.page == .platforms ? "Choose your services" : "Edit your services")
                        .font(.title3).bold()
                        .foregroundColor(.mkText)
                }
                Spacer()
                if app.page != .platforms {
                    IconButton(icon: "xmark") { dismiss() }
                }
                IconButton(icon: "rectangle.portrait.and.arrow.right") { app.logout() }
            }
            .padding(.horizontal, 20)
            .padding(.top, 20)
            .padding(.bottom, 16)

            if isLoading {
                Spacer()
                ProgressView().tint(.mkAccent)
                Spacer()
            } else {
                ScrollView {
                    VStack(spacing: 20) {
                        Text("Select every service you subscribe to. StreamScore will show titles available across your chosen platforms.")
                            .font(.subheadline)
                            .foregroundColor(.mkMuted)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 16)

                        LazyVGrid(columns: columns, spacing: 12) {
                            ForEach(allPlatforms) { p in
                                PlatformTile(platform: p, isSelected: selected.contains(p.key)) {
                                    withAnimation(.spring(duration: 0.2)) {
                                        if selected.contains(p.key) { selected.remove(p.key) }
                                        else { selected.insert(p.key) }
                                    }
                                }
                            }
                        }
                        .padding(.horizontal, 16)

                        if let err = errorMsg {
                            Text(err).font(.caption).foregroundColor(.mkAccent)
                        }

                        MKButton(
                            label: isSaving ? "Saving…" : "Save & Continue",
                            icon: "checkmark.circle.fill",
                            isLoading: isSaving
                        ) { Task { await save() } }
                        .padding(.horizontal, 20)
                        .padding(.bottom, 32)
                    }
                    .padding(.top, 8)
                }
            }
        }
        .task { await load() }
    }

    @MainActor func load() async {
        isLoading = true; errorMsg = nil
        do {
            let resp: PlatformResponse = try await APIService.shared.get("/platforms", token: app.token)
            selected = Set(resp.platforms)
            app.savePlatforms(resp.platforms)
        } catch {
            // Pre-fill with locally cached platforms if network fails
            if !app.selectedPlatforms.isEmpty {
                selected = Set(app.selectedPlatforms)
            } else {
                errorMsg = "Couldn't load saved services. Select yours below."
            }
        }
        isLoading = false
    }

    @MainActor func save() async {
        guard !selected.isEmpty else { errorMsg = "Select at least one service."; return }
        isSaving = true; errorMsg = nil
        let platforms = Array(selected)
        app.savePlatforms(platforms)
        _ = try? await APIService.shared.put(
            "/platforms",
            body: ["platforms": platforms],
            token: app.token
        ) as GenericResponse
        isSaving = false
        // If shown as a sheet (editing), dismiss it. If onboarding flow, navigate to catalog.
        if app.page == .platforms {
            app.page = .catalog
        } else {
            dismiss()
        }
    }
}

struct PlatformTile: View {
    let platform: StreamingPlatform
    let isSelected: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(spacing: 6) {
                ZStack {
                    RoundedRectangle(cornerRadius: 14)
                        .fill(isSelected ? platform.accentColor.opacity(0.18) : Color.mkSurface)
                        .frame(width: 62, height: 62)
                        .overlay(
                            RoundedRectangle(cornerRadius: 14)
                                .stroke(isSelected ? platform.accentColor : Color.mkBorder, lineWidth: isSelected ? 1.8 : 1)
                        )

                    Image(platform.logoAsset)
                            .resizable()
                            .scaledToFit()
                            .frame(width: 46, height: 46)
                            .clipShape(RoundedRectangle(cornerRadius: 10))

                    if isSelected {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 14))
                            .foregroundColor(platform.accentColor)
                            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                            .padding(4)
                    }
                }

                Text(platform.name)
                    .font(.system(size: 9, weight: .medium))
                    .foregroundColor(isSelected ? .mkText : .mkMuted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
        }
        .buttonStyle(ScaleButtonStyle())
    }
}

// MARK: - Catalog

struct CatalogView: View {
    @EnvironmentObject var app: AppState
    @State private var movies: [CatalogItem] = []
    @State private var meta: CatalogMeta?
    @State private var isLoading = false
    @State private var errorMsg: String?
    @State private var mediaType    = "all"
    @State private var sortBy       = "popularity"
    @State private var page         = 1
    @State private var totalPages   = 1
    @State private var showSettings = false
    @State private var showGenrePicker = false
    @State private var genreFilters: Set<String> = []
    @State private var pollingTask: Task<Void, Never>?

    static let allGenres: [(key: String, label: String)] = [
        ("Action","Action"), ("Adventure","Adventure"), ("Animation","Animation"),
        ("anime","Anime ✦"), ("Comedy","Comedy"), ("Crime","Crime"),
        ("Documentary","Documentary"), ("Drama","Drama"), ("Fantasy","Fantasy"),
        ("Horror","Horror"), ("Mystery","Mystery"), ("Romance","Romance"),
        ("Science Fiction","Sci-Fi"), ("Thriller","Thriller"), ("Western","Western")
    ]

    var body: some View {
        VStack(spacing: 0) {
            topBar.padding(.horizontal, 16).padding(.top, 16).padding(.bottom, 10)

            filterBar.padding(.bottom, 8)

            Divider().overlay(Color.mkBorder)

            if isLoading || (movies.isEmpty && meta?.refreshing == true) {
                Spacer()
                VStack(spacing: 10) {
                    ProgressView().tint(.mkAccent)
                    Text(meta?.refreshing == true && !isLoading
                         ? "Building your catalog… check back in a moment."
                         : "Loading catalog…")
                        .font(.caption).foregroundColor(.mkMuted)
                        .multilineTextAlignment(.center).padding(.horizontal, 40)
                }
                Spacer()
            } else if movies.isEmpty && !isLoading {
                if let err = errorMsg {
                    Spacer()
                    VStack(spacing: 12) {
                        Image(systemName: "wifi.exclamationmark")
                            .font(.system(size: 40))
                            .foregroundColor(.mkAccent)
                        Text("Couldn't load titles")
                            .font(.title3).bold()
                            .foregroundColor(.mkMuted)
                        Text(err)
                            .font(.subheadline)
                            .foregroundColor(.mkMuted.opacity(0.7))
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 40)
                        MKButton(label: "Retry", icon: "arrow.clockwise") {
                            Task { await fetch() }
                        }
                        .frame(maxWidth: 180)
                        .padding(.top, 4)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    Spacer()
                } else {
                    emptyState
                }
            } else {
                ScrollView {
                    LazyVStack(spacing: 12) {
                        if let m = meta { metaBanner(m).padding(.horizontal, 16) }
                        ForEach(movies) { movie in
                            MovieCardView(movie: movie).padding(.horizontal, 16)
                        }
                        if totalPages > 1 { paginationBar.padding(.horizontal, 16).padding(.bottom, 24) }
                    }
                    .padding(.top, 12)
                }
            }
        }
        .sheet(isPresented: $showSettings) {
            PlatformsView().environmentObject(app)
        }
        .sheet(isPresented: $showGenrePicker) {
            GenrePickerSheet(selected: $genreFilters) {
                page = 1; Task { await fetch() }
            }
        }
        .task {
            if app.selectedPlatforms.isEmpty { await loadPlatforms() }
            // If still no platforms after syncing with server, send user to setup
            if app.selectedPlatforms.isEmpty {
                showSettings = true
                return
            }
            await fetch()
            startPollingIfNeeded()
        }
        .onChange(of: showSettings) { open in
            if !open { Task { await fetch() } }
        }
        .onDisappear { pollingTask?.cancel() }
    }

    // MARK: Sub-views

    var topBar: some View {
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text("🎬 STREAMSCORE")
                    .font(.system(size: 11, weight: .semibold)).kerning(1.2)
                    .foregroundColor(.mkAccent)
                Text("Streaming Catalog")
                    .font(.system(size: 20, weight: .bold)).foregroundColor(.mkText)
            }
            Spacer()
            IconButton(icon: "arrow.clockwise", spinning: isLoading) { Task { await fetch() } }
            IconButton(icon: "gearshape.fill") { showSettings = true }
            IconButton(icon: "rectangle.portrait.and.arrow.right") { app.logout() }
        }
    }

    var filterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                Menu {
                    ForEach([("tv","TV Shows"),("movie","Movies"),("all","All Titles"),("documentary","Documentary")], id: \.0) { k, l in
                        Button(l) { mediaType = k; page = 1; Task { await fetch() } }
                    }
                } label: {
                    FilterChip(label: mediaTypeLabel, icon: "tv", active: mediaType != "all")
                }
                Menu {
                    ForEach([("popularity","Popularity"),("tmdb","TMDb"),("imdb","IMDb"),("rotten_tomatoes","Rotten Tomatoes"),("metacritic","Metacritic"),("release_date","Release Date"),("title","A–Z")], id: \.0) { k, l in
                        Button(l) { sortBy = k; page = 1; Task { await fetch() } }
                    }
                } label: {
                    FilterChip(label: sortLabel, icon: "arrow.up.arrow.down", active: sortBy != "popularity")
                }
                // Genre multi-select
                Button { showGenrePicker = true } label: {
                    FilterChip(
                        label: genreFilters.isEmpty ? "Genres" : "\(genreFilters.count) Genre\(genreFilters.count == 1 ? "" : "s")",
                        icon: "theatermasks",
                        active: !genreFilters.isEmpty
                    )
                }
                // Services badge
                if !app.selectedPlatforms.isEmpty {
                    HStack(spacing: 5) {
                        Image(systemName: "play.rectangle.on.rectangle").font(.system(size: 10))
                        Text("\(app.selectedPlatforms.count) services")
                            .font(.system(size: 12))
                    }
                    .foregroundColor(.mkMuted)
                    .padding(.horizontal, 10).padding(.vertical, 7)
                    .background(Color.mkSurface)
                    .clipShape(Capsule())
                    .overlay(Capsule().stroke(Color.mkBorder, lineWidth: 1))
                }
            }
            .padding(.horizontal, 16)
        }
    }

    var emptyState: some View {
        Spacer()
        return VStack(spacing: 14) {
            if app.selectedPlatforms.isEmpty {
                Image(systemName: "play.rectangle.on.rectangle").font(.system(size: 44)).foregroundColor(.mkMuted)
                Text("No services selected").font(.title3).bold().foregroundColor(.mkMuted)
                Text("Add your streaming services to see what's available to watch.")
                    .font(.subheadline).foregroundColor(.mkMuted.opacity(0.7)).multilineTextAlignment(.center).padding(.horizontal, 40)
                MKButton(label: "Add Services", icon: "plus.circle.fill") { showSettings = true }
                    .frame(maxWidth: 220).padding(.top, 4)
            } else {
                Image(systemName: "popcorn").font(.system(size: 44)).foregroundColor(.mkMuted)
                Text("No titles found").font(.title3).bold().foregroundColor(.mkMuted)
                Text("Adjust your filters or add streaming services.").font(.subheadline).foregroundColor(.mkMuted.opacity(0.7)).multilineTextAlignment(.center).padding(.horizontal, 40)
                MKButton(label: "Edit Services", icon: "gearshape.fill") { showSettings = true }
                    .frame(maxWidth: 220).padding(.top, 4)
            }
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
            Button {
                page = max(1, page - 1); Task { await fetch() }
            } label: {
                Image(systemName: "chevron.left")
                    .frame(width: 40, height: 40)
                    .background(Color.mkSurface)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .foregroundColor(page == 1 ? .mkMuted.opacity(0.35) : .mkText)
            }
            .disabled(page == 1)

            Text("Page \(page) of \(totalPages)")
                .font(.caption).foregroundColor(.mkMuted).frame(maxWidth: .infinity)

            Button {
                page = min(totalPages, page + 1); Task { await fetch() }
            } label: {
                Image(systemName: "chevron.right")
                    .frame(width: 40, height: 40)
                    .background(Color.mkSurface)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .foregroundColor(page == totalPages ? .mkMuted.opacity(0.35) : .mkText)
            }
            .disabled(page == totalPages)
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
        default: return "Popularity"
        }
    }

    // MARK: Networking

    @MainActor func loadPlatforms() async {
        do {
            let resp: PlatformResponse = try await APIService.shared.get("/platforms", token: app.token)
            app.savePlatforms(resp.platforms)
        } catch {
            // Use cached platforms — no action needed
        }
    }

    @MainActor func fetch() async {
        isLoading = true; errorMsg = nil
        var params: [String: String] = [
            "page":      String(page),
            "sortBy":    sortBy.isEmpty ? "popularity" : sortBy,
            "mediaType": mediaType.isEmpty ? "all" : mediaType
        ]
        if !app.selectedPlatforms.isEmpty {
            params["serviceFilters"] = app.selectedPlatforms.joined(separator: ",")
        }
        if !genreFilters.isEmpty {
            params["genreFilters"] = genreFilters.joined(separator: ",")
        }
        do {
            let resp: CatalogResponse = try await APIService.shared.get("/movies", params: params, token: app.token)
            // Surface any server-side error (e.g. DB not ready) instead of silently showing empty
            if let serverError = resp.error, resp.catalog.isEmpty {
                errorMsg = serverError
                isLoading = false
                return
            }
            movies = resp.catalog
            meta   = resp.meta
            totalPages = resp.meta?.totalPages ?? max(1, Int(ceil(Double(resp.meta?.resultCount ?? 0) / 24.0)))
            if meta?.refreshing == true {
                startPollingIfNeeded()
            }
        } catch APIError.unauthorized {
            app.logout()
        } catch {
            errorMsg = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
        isLoading = false
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

// MARK: - Movie Card

struct MovieCardView: View {
    let movie: CatalogItem
    var isTV: Bool { movie.mediaType == "tv" }

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            posterView
            infoColumn
        }
        .padding(14)
        .background(Color.mkCard)
        .clipShape(RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(Color.mkBorder, lineWidth: 1))
        .overlay(accentBar)
    }

    // Left accent bar — blue for TV, red for movies
    var accentBar: some View {
        HStack {
            RoundedRectangle(cornerRadius: 18)
                .fill(isTV ? Color.mkTV.opacity(0.7) : Color.mkAccent.opacity(0.7))
                .frame(width: 3)
            Spacer()
        }
        .clipShape(RoundedRectangle(cornerRadius: 18))
    }

    var posterView: some View {
        Group {
            if let urlStr = movie.posterUrl, let url = URL(string: urlStr) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let img): img.resizable().scaledToFill()
                    default: posterPlaceholder
                    }
                }
            } else {
                posterPlaceholder
            }
        }
        .frame(width: 88, height: 132)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.mkBorder, lineWidth: 1))
    }

    var posterPlaceholder: some View {
        ZStack {
            Color.mkSurface
            Image(systemName: "film").font(.system(size: 22)).foregroundColor(.mkMuted.opacity(0.4))
        }
    }

    var infoColumn: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(movie.title)
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(.mkText)
                .lineLimit(2)

            // Type + Year chips
            HStack(spacing: 6) {
                TypeChip(label: isTV ? "TV" : "Film", isTV: isTV)
                if let y = movie.year {
                    PillChip(text: String(y), color: .mkMuted)
                }
            }

            if let ov = movie.overview, !ov.isEmpty {
                Text(ov)
                    .font(.system(size: 12))
                    .foregroundColor(.mkMuted)
                    .lineLimit(3)
            }

            if let genres = movie.genres, !genres.isEmpty {
                HStack(spacing: 4) {
                    ForEach(genres.prefix(3), id: \.self) { g in PillChip(text: g, color: .mkMuted) }
                }
            }

            if let providers = movie.availableOn, !providers.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 5) {
                        ForEach(providers.prefix(4), id: \.self) { name in ProviderChip(name: name) }
                    }
                }
            }

            ratingRow
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    var ratingRow: some View {
        let ratings = buildRatings()
        if !ratings.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 7) {
                    ForEach(ratings, id: \.label) { r in RatingChip(entry: r) }
                    // Show loading indicator if only TMDb is present (OMDB ratings pending)
                    if ratings.count == 1 && ratings[0].label == "TMDb" {
                        Text("⏳ Ratings loading…")
                            .font(.system(size: 10, weight: .medium))
                            .foregroundColor(.mkMuted)
                    }
                }
            }
            .padding(.top, 2)
        }
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

// MARK: - Reusable Components

struct FilterChip: View {
    let label: String; let icon: String; let active: Bool
    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: icon).font(.caption2)
            Text(label).font(.system(size: 13, weight: .medium))
            Image(systemName: "chevron.down").font(.system(size: 9))
        }
        .foregroundColor(active ? .mkAccent : .mkMuted)
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(active ? Color.mkAccent.opacity(0.1) : Color.mkSurface)
        .clipShape(Capsule())
        .overlay(Capsule().stroke(active ? Color.mkAccent.opacity(0.4) : Color.mkBorder, lineWidth: 1))
    }
}

struct TypeChip: View {
    let label: String; let isTV: Bool
    var body: some View {
        Text(label)
            .font(.system(size: 9, weight: .bold))
            .kerning(0.3)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(isTV ? Color.mkTV.opacity(0.18) : Color.mkAccent.opacity(0.18))
            .foregroundColor(isTV ? .mkTV : .mkAccent)
            .clipShape(Capsule())
    }
}

// Genre chips — distinct purple tint so they stand out from provider chips
struct PillChip: View {
    let text: String; let color: Color
    static let genreTint = Color(red: 0.56, green: 0.38, blue: 1.0)
    var body: some View {
        Text(text)
            .font(.system(size: 10, weight: .semibold))
            .kerning(0.2)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(Self.genreTint.opacity(0.13))
            .foregroundColor(Self.genreTint)
            .clipShape(Capsule())
            .overlay(Capsule().stroke(Self.genreTint.opacity(0.25), lineWidth: 1))
    }
}

// Streaming provider chips — logo + name with subtle glow
struct ProviderChip: View {
    let name: String
    var platform: StreamingPlatform? {
        allPlatforms.first { name.lowercased().contains($0.key) || $0.name.lowercased() == name.lowercased() }
    }
    var body: some View {
        HStack(spacing: 4) {
            if let p = platform {
                Image(p.logoAsset).resizable().scaledToFit()
                    .frame(width: 14, height: 14)
                    .clipShape(RoundedRectangle(cornerRadius: 3))
            }
            Text(name.count > 11 ? String(name.prefix(9)) + "…" : name)
                .font(.system(size: 10, weight: .medium))
                .foregroundColor(.mkText.opacity(0.75))
        }
        .padding(.horizontal, 8).padding(.vertical, 4)
        .background(Color.mkSurface)
        .clipShape(Capsule())
        .overlay(Capsule().stroke(Color.mkBorder, lineWidth: 1))
    }
}

struct RatingChip: View {
    let entry: MovieCardView.RatingEntry
    var body: some View {
        HStack(spacing: 5) {
            if let asset = entry.logoAsset {
                Image(asset).resizable().scaledToFit().frame(width: 14, height: 14)
            } else {
                Circle().fill(entry.color).frame(width: 7, height: 7)
            }
            VStack(alignment: .leading, spacing: 0) {
                Text(entry.label).font(.system(size: 8)).foregroundColor(.mkMuted)
                Text(entry.value).font(.system(size: 11, weight: .semibold)).foregroundColor(.mkText)
            }
        }
        .padding(.horizontal, 8).padding(.vertical, 5)
        .background(Color.mkBackground)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(entry.color.opacity(0.3), lineWidth: 1))
    }
}

// MARK: - Genre Picker Sheet

struct GenrePickerSheet: View {
    @Binding var selected: Set<String>
    @Environment(\.dismiss) private var dismiss
    let onApply: () -> Void

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 10), count: 3)

    var body: some View {
        NavigationView {
            ZStack {
                Color.mkBackground.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        Text("Select one or more genres. Results matching any selected genre will be shown.")
                            .font(.subheadline)
                            .foregroundColor(.mkMuted)
                            .padding(.horizontal, 20)
                            .padding(.top, 4)

                        LazyVGrid(columns: columns, spacing: 10) {
                            ForEach(CatalogView.allGenres, id: \.key) { genre in
                                let isOn = selected.contains(genre.key)
                                Button {
                                    withAnimation(.spring(duration: 0.2)) {
                                        if isOn { selected.remove(genre.key) }
                                        else     { selected.insert(genre.key) }
                                    }
                                } label: {
                                    Text(genre.label)
                                        .font(.system(size: 13, weight: .semibold))
                                        .multilineTextAlignment(.center)
                                        .lineLimit(2)
                                        .minimumScaleFactor(0.8)
                                        .frame(maxWidth: .infinity, minHeight: 48)
                                        .foregroundColor(isOn ? .white : .mkMuted)
                                        .background(
                                            RoundedRectangle(cornerRadius: 12)
                                                .fill(isOn
                                                    ? Color(red: 0.56, green: 0.38, blue: 1.0).opacity(0.28)
                                                    : Color.mkSurface)
                                        )
                                        .overlay(
                                            RoundedRectangle(cornerRadius: 12)
                                                .stroke(isOn
                                                    ? Color(red: 0.56, green: 0.38, blue: 1.0).opacity(0.6)
                                                    : Color.mkBorder, lineWidth: 1)
                                        )
                                }
                                .buttonStyle(ScaleButtonStyle())
                            }
                        }
                        .padding(.horizontal, 16)

                        if !selected.isEmpty {
                            Button(role: .destructive) {
                                selected.removeAll()
                            } label: {
                                Label("Clear All Genres", systemImage: "xmark.circle")
                                    .font(.subheadline)
                                    .foregroundColor(.mkAccent)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.top, 4)
                        }
                    }
                    .padding(.bottom, 24)
                }
            }
            .navigationTitle("Filter by Genre")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") { dismiss() }
                        .foregroundColor(.mkMuted)
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Apply") {
                        onApply()
                        dismiss()
                    }
                    .fontWeight(.semibold)
                    .foregroundColor(.mkAccent)
                }
            }
        }
    }
}

// MARK: - Form Controls

struct MKTextField: View {
    let placeholder: String
    @Binding var text: String
    let icon: String
    var isSecure: Bool = false
    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 15))
                .foregroundColor(focused ? .mkAccent : .mkMuted)
                .frame(width: 20)
            if isSecure {
                SecureField(placeholder, text: $text).focused($focused)
            } else {
                TextField(placeholder, text: $text)
                    .disableAutocap().autocorrectionDisabled().focused($focused)
            }
        }
        .foregroundColor(.mkText)
        .padding(.horizontal, 16).padding(.vertical, 14)
        .background(Color.mkBackground)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(focused ? Color.mkAccent.opacity(0.6) : Color.mkBorder, lineWidth: 1.5)
        )
    }
}

struct MKButton: View {
    let label: String
    let icon: String
    var isLoading: Bool = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if isLoading { ProgressView().tint(.white).scaleEffect(0.85) }
                else { Image(systemName: icon).font(.system(size: 15)) }
                Text(label).font(.system(size: 16, weight: .semibold))
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 15)
            .background(LinearGradient(colors: [.mkAccent, Color(red: 0.82, green: 0.20, blue: 0.32)],
                                       startPoint: .leading, endPoint: .trailing))
            .foregroundColor(.white)
            .clipShape(RoundedRectangle(cornerRadius: 15))
        }
        .disabled(isLoading)
        .buttonStyle(ScaleButtonStyle())
    }
}

struct IconButton: View {
    let icon: String
    var spinning: Bool = false
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 17))
                .foregroundColor(.mkMuted)
                .frame(width: 36, height: 36)
                .background(Color.mkSurface)
                .clipShape(Circle())
                .rotationEffect(.degrees(spinning ? 360 : 0))
                .animation(spinning ? .linear(duration: 1).repeatForever(autoreverses: false) : .default, value: spinning)
        }
        .buttonStyle(ScaleButtonStyle())
    }
}

struct ScaleButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.95 : 1.0)
            .animation(.spring(duration: 0.18), value: configuration.isPressed)
    }
}

// MARK: - Preview

#Preview {
    ContentView()
}

// MARK: - View Helpers

extension View {
    @ViewBuilder
    func scrollBounceBasedOnSize() -> some View {
        #if os(iOS)
        if #available(iOS 16.4, *) {
            self.scrollBounceBehavior(.basedOnSize)
        } else {
            self
        }
        #else
        self
        #endif
    }

    @ViewBuilder
    func disableAutocap() -> some View {
        #if os(iOS)
        self.textInputAutocapitalization(.never)
        #else
        self
        #endif
    }
}
