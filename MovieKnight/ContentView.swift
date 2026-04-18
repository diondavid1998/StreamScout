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

    init() {
        token    = UserDefaults.standard.string(forKey: "mk_token")    ?? ""
        username = UserDefaults.standard.string(forKey: "mk_username") ?? ""
        page = token.isEmpty ? .auth : .catalog
    }

    func saveSession(token: String, username: String) {
        self.token    = token
        self.username = username
        UserDefaults.standard.set(token,    forKey: "mk_token")
        UserDefaults.standard.set(username, forKey: "mk_username")
    }

    func logout() {
        token = ""; username = ""; selectedPlatforms = []
        UserDefaults.standard.removeObject(forKey: "mk_token")
        UserDefaults.standard.removeObject(forKey: "mk_username")
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
        .scrollBounceBehavior(.basedOnSize)
    }

    func authenticate() async {
        guard !username.trimmingCharacters(in: .whitespaces).isEmpty,
              !password.isEmpty else { errorMsg = "Please fill in both fields."; return }
        isLoading = true; errorMsg = nil
        do {
            let resp: AuthResponse = try await APIService.shared.post(
                mode == .login ? "/login" : "/register",
                body: ["username": username, "password": password]
            )
            if let t = resp.token {
                app.saveSession(token: t, username: username)
                app.page = .catalog
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
                    IconButton(icon: "xmark") { app.page = .catalog }
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

    func load() async {
        isLoading = true
        if let resp = try? await APIService.shared.get("/platforms", token: app.token) as PlatformResponse {
            selected = Set(resp.platforms)
            app.selectedPlatforms = resp.platforms
        }
        isLoading = false
    }

    func save() async {
        isSaving = true; errorMsg = nil
        do {
            let _: GenericResponse = try await APIService.shared.put(
                "/platforms",
                body: ["platforms": Array(selected)],
                token: app.token
            )
            app.selectedPlatforms = Array(selected)
            app.page = .catalog
        } catch {
            errorMsg = "Failed to save. Try again."
        }
        isSaving = false
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

                    if UIImage(named: platform.logoAsset) != nil {
                        Image(platform.logoAsset)
                            .resizable()
                            .scaledToFit()
                            .frame(width: 46, height: 46)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                    } else {
                        Text(String(platform.name.prefix(2)))
                            .font(.system(size: 20, weight: .bold, design: .rounded))
                            .foregroundColor(platform.accentColor)
                    }

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
    @State private var mediaType  = "tv"
    @State private var sortBy     = "popularity"
    @State private var page       = 1
    @State private var totalPages = 1
    @State private var showSettings = false

    var body: some View {
        VStack(spacing: 0) {
            topBar.padding(.horizontal, 16).padding(.top, 16).padding(.bottom, 10)

            filterBar.padding(.bottom, 8)

            Divider().background(Color.mkBorder.opacity(0.4))

            if isLoading {
                Spacer()
                VStack(spacing: 10) {
                    ProgressView().tint(.mkAccent)
                    Text("Loading catalog…").font(.caption).foregroundColor(.mkMuted)
                }
                Spacer()
            } else if movies.isEmpty && !isLoading {
                emptyState
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
        .task {
            if app.selectedPlatforms.isEmpty { await loadPlatforms() }
            await fetch()
        }
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
                    FilterChip(label: mediaTypeLabel, icon: "tv", active: true)
                }
                Menu {
                    ForEach([("popularity","Popularity"),("tmdb","TMDb"),("imdb","IMDb"),("rotten_tomatoes","Rotten Tomatoes"),("metacritic","Metacritic"),("release_date","Release Date"),("title","A–Z")], id: \.0) { k, l in
                        Button(l) { sortBy = k; page = 1; Task { await fetch() } }
                    }
                } label: {
                    FilterChip(label: sortLabel, icon: "arrow.up.arrow.down", active: false)
                }
                if !app.selectedPlatforms.isEmpty {
                    Label("\(app.selectedPlatforms.count) services", systemImage: "play.rectangle.on.rectangle")
                        .font(.system(size: 12))
                        .foregroundColor(.mkMuted)
                        .padding(.horizontal, 10).padding(.vertical, 7)
                        .background(Color.mkSurface)
                        .clipShape(Capsule())
                }
            }
            .padding(.horizontal, 16)
        }
    }

    var emptyState: some View {
        Spacer()
        return VStack(spacing: 14) {
            Image(systemName: "film.slash").font(.system(size: 44)).foregroundColor(.mkMuted)
            Text("No titles found").font(.title3).bold().foregroundColor(.mkMuted)
            Text("Adjust your filters or add streaming services.").font(.subheadline).foregroundColor(.mkMuted.opacity(0.7)).multilineTextAlignment(.center).padding(.horizontal, 40)
            MKButton(label: "Edit Services", icon: "gearshape.fill") { showSettings = true }
                .frame(maxWidth: 220).padding(.top, 4)
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

    func loadPlatforms() async {
        if let resp = try? await APIService.shared.get("/platforms", token: app.token) as PlatformResponse {
            app.selectedPlatforms = resp.platforms
        }
    }

    func fetch() async {
        isLoading = true; errorMsg = nil
        var params: [String: String] = ["page": String(page), "sort": sortBy, "type": mediaType]
        if !app.selectedPlatforms.isEmpty {
            params["services"] = app.selectedPlatforms.joined(separator: ",")
        }
        do {
            let resp: CatalogResponse = try await APIService.shared.get("/movies", params: params, token: app.token)
            movies = resp.movies ?? []
            meta   = resp.meta
            if let count = resp.meta?.resultCount {
                totalPages = max(1, Int(ceil(Double(count) / 20.0)))
            }
        } catch APIError.unauthorized {
            app.logout()
        } catch {
            errorMsg = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
        isLoading = false
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
            let pct = Int(v.replacingOccurrences(of: "%", with: "")) ?? 0
            let fresh = pct >= 60
            out.append(.init(label: "RT", value: v, logoAsset: fresh ? "rt_fresh" : "rt_rotten",
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
            .padding(.horizontal, 7).padding(.vertical, 3)
            .background(isTV ? Color.mkTV.opacity(0.17) : Color.mkAccent.opacity(0.17))
            .foregroundColor(isTV ? .mkTV : .mkAccent)
            .clipShape(Capsule())
    }
}

struct PillChip: View {
    let text: String; let color: Color
    var body: some View {
        Text(text)
            .font(.system(size: 10))
            .padding(.horizontal, 7).padding(.vertical, 3)
            .background(Color.mkSurface)
            .foregroundColor(color)
            .clipShape(Capsule())
    }
}

struct ProviderChip: View {
    let name: String
    var platform: StreamingPlatform? {
        allPlatforms.first { name.lowercased().contains($0.key) || $0.name.lowercased() == name.lowercased() }
    }
    var body: some View {
        HStack(spacing: 3) {
            if let p = platform, UIImage(named: p.logoAsset) != nil {
                Image(p.logoAsset).resizable().scaledToFit()
                    .frame(width: 12, height: 12)
                    .clipShape(RoundedRectangle(cornerRadius: 2))
            }
            Text(name.count > 12 ? String(name.prefix(10)) + "…" : name)
                .font(.system(size: 9)).foregroundColor(.mkMuted)
        }
        .padding(.horizontal, 6).padding(.vertical, 2)
        .background(Color.mkBackground)
        .clipShape(Capsule())
    }
}

struct RatingChip: View {
    let entry: MovieCardView.RatingEntry
    var body: some View {
        HStack(spacing: 5) {
            if let asset = entry.logoAsset, UIImage(named: asset) != nil {
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
                    .autocapitalization(.none).autocorrectionDisabled().focused($focused)
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
