//
//  ContentView.swift
//  StreamScore
//
//  Created by Dion David on 4/7/26.
//

import SwiftUI
import PhotosUI

@MainActor
final class AppState: ObservableObject {
    enum Page { case loading, auth, platforms, catalog }

    @Published var page: Page = .loading
    @Published var token: String = ""
    @Published var username: String = ""
    @Published var selectedPlatforms: [String] = []
    @Published var selectedLanguages: [String] = []
    @Published var watchedIds: Set<String> = []
    @Published var watchlistIds: Set<String> = []

    private let tokenKey      = "mk_token"
    private let usernameKey   = "mk_username"
    private let platformsKey  = "mk_platforms"
    private let languagesKey  = "mk_languages"
    private let watchedKey    = "mk_watched_ids"
    private let watchlistKey  = "mk_watchlist_ids"

    init() {
        token    = UserDefaults.standard.string(forKey: tokenKey)?.trimmingCharacters(in: .whitespaces) ?? ""
        username = UserDefaults.standard.string(forKey: usernameKey) ?? ""
        selectedPlatforms = UserDefaults.standard.stringArray(forKey: platformsKey) ?? []
        selectedLanguages = UserDefaults.standard.stringArray(forKey: languagesKey) ?? []
        watchedIds  = Set(UserDefaults.standard.stringArray(forKey: watchedKey) ?? [])
        watchlistIds = Set(UserDefaults.standard.stringArray(forKey: watchlistKey) ?? [])
        page = token.isEmpty ? .auth : .catalog
    }

    func saveSession(token: String, username: String, isNewUser: Bool = false) {
        self.token    = token.trimmingCharacters(in: .whitespaces)
        self.username = username
        UserDefaults.standard.set(self.token, forKey: tokenKey)
        UserDefaults.standard.set(username,   forKey: usernameKey)
        page = isNewUser ? .platforms : .catalog
    }

    func savePlatforms(_ platforms: [String]) {
        selectedPlatforms = platforms
        UserDefaults.standard.set(platforms, forKey: platformsKey)
    }

    func saveLanguages(_ languages: [String]) {
        selectedLanguages = languages
        UserDefaults.standard.set(languages, forKey: languagesKey)
    }

    func updateToken(_ newToken: String) {
        token = newToken.trimmingCharacters(in: .whitespaces)
        UserDefaults.standard.set(token, forKey: tokenKey)
    }

    func updateUsername(_ newUsername: String) {
        username = newUsername
        UserDefaults.standard.set(username, forKey: usernameKey)
    }

    func setWatched(_ id: String, watched: Bool) {
        if watched { watchedIds.insert(id) } else { watchedIds.remove(id) }
        UserDefaults.standard.set(Array(watchedIds), forKey: watchedKey)
    }

    func replaceWatchedIds(_ ids: [String]) {
        watchedIds = Set(ids)
        UserDefaults.standard.set(ids, forKey: watchedKey)
    }

    func setWatchlisted(_ id: String, on: Bool) {
        if on { watchlistIds.insert(id) } else { watchlistIds.remove(id) }
        UserDefaults.standard.set(Array(watchlistIds), forKey: watchlistKey)
    }

    func replaceWatchlistIds(_ ids: [String]) {
        watchlistIds = Set(ids)
        UserDefaults.standard.set(ids, forKey: watchlistKey)
    }

    func logout() {
        token = ""; username = ""; selectedPlatforms = []; selectedLanguages = []
        watchedIds = []; watchlistIds = []
        UserDefaults.standard.removeObject(forKey: tokenKey)
        UserDefaults.standard.removeObject(forKey: usernameKey)
        UserDefaults.standard.removeObject(forKey: platformsKey)
        UserDefaults.standard.removeObject(forKey: languagesKey)
        UserDefaults.standard.removeObject(forKey: watchedKey)
        UserDefaults.standard.removeObject(forKey: watchlistKey)
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

/// Reusable inline StreamScout brand header (logo + name side by side)
struct StreamScoutTitle: View {
    var size: CGFloat = 28
    var logoSize: CGFloat = 32

    var body: some View {
        HStack(spacing: 10) {
            Image("StreamScoreLogo")
                .resizable()
                .scaledToFit()
                .frame(width: logoSize, height: logoSize)
                .clipShape(RoundedRectangle(cornerRadius: logoSize * 0.22, style: .continuous))
                .shadow(color: .mkAccent.opacity(0.4), radius: 6, x: 0, y: 3)
            Text("StreamScout")
                .font(.system(size: size, weight: .bold, design: .rounded))
                .foregroundStyle(LinearGradient(colors: [.mkAccent, .mkAccentAlt], startPoint: .leading, endPoint: .trailing))
        }
    }
}

struct LoadingView: View {
    var body: some View {
        VStack(spacing: 16) {
            StreamScoutTitle(size: 30, logoSize: 34)
            ProgressView().tint(.mkAccent).padding(.top, 8)
        }
    }
}

// MARK: - Auth

struct AuthView: View {
    @EnvironmentObject var app: AppState

    enum Mode: CaseIterable { case login, register }
    enum ResetStep { case none, enterEmail, enterCode }

    @State private var mode: Mode = .login
    @State private var username = ""
    @State private var password = ""
    @State private var registerEmail = ""
    @State private var isLoading = false
    @State private var errorMsg: String?
    @State private var successMsg: String?

    // Forgot password
    @State private var resetStep: ResetStep = .none
    @State private var resetEmail = ""
    @State private var resetCode = ""
    @State private var resetNewPass = ""

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                // Hero
                VStack(spacing: 10) {
                    StreamScoutTitle(size: 34, logoSize: 40)
                        .padding(.top, 60)
                    Text("Your streaming catalog, unified.")
                        .font(.subheadline)
                        .foregroundColor(.mkMuted)
                        .padding(.bottom, 36)
                }

                // Card
                VStack(spacing: 18) {
                    if resetStep == .enterEmail {
                        resetEmailCard
                    } else if resetStep == .enterCode {
                        resetCodeCard
                    } else {
                        mainAuthCard
                    }
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

    // MARK: Main auth card

    var mainAuthCard: some View {
        VStack(spacing: 18) {
            HStack(spacing: 0) {
                ForEach(Mode.allCases, id: \.self) { m in
                    Button {
                        withAnimation(.spring(duration: 0.22)) { mode = m; clearMessages() }
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

            if mode == .register {
                MKTextField(placeholder: "Email (optional — for password reset)", text: $registerEmail, icon: "envelope.fill")
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }

            MKTextField(placeholder: "Password", text: $password, icon: "lock.fill", isSecure: true)

            feedbackView

            MKButton(
                label: isLoading ? "Working…" : (mode == .login ? "Sign In" : "Create Account"),
                icon: mode == .login ? "arrow.right.circle.fill" : "person.badge.plus",
                isLoading: isLoading
            ) { Task { await authenticate() } }

            if mode == .login {
                Button {
                    withAnimation { resetStep = .enterEmail; clearMessages() }
                } label: {
                    Text("Forgot password?")
                        .font(.system(size: 13))
                        .foregroundColor(.mkMuted)
                }
            }
        }
    }

    // MARK: Reset step 1 — enter email

    var resetEmailCard: some View {
        VStack(spacing: 18) {
            VStack(spacing: 4) {
                Text("Reset Password")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundColor(.mkText)
                Text("Enter the email on your account and we'll send a code.")
                    .font(.caption)
                    .foregroundColor(.mkMuted)
                    .multilineTextAlignment(.center)
            }
            MKTextField(placeholder: "Email address", text: $resetEmail, icon: "envelope.fill")
            feedbackView
            MKButton(label: isLoading ? "Sending…" : "Send Reset Code",
                     icon: "paperplane.fill", isLoading: isLoading) {
                Task { await sendResetCode() }
            }
            Button { withAnimation { resetStep = .none; clearMessages() } } label: {
                Text("← Back to Sign In").font(.system(size: 13)).foregroundColor(.mkMuted)
            }
        }
    }

    // MARK: Reset step 2 — enter code + new password

    var resetCodeCard: some View {
        VStack(spacing: 18) {
            VStack(spacing: 4) {
                Text("Enter Code")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundColor(.mkText)
                Text("Enter the 6-digit code sent to \(resetEmail) and your new password.")
                    .font(.caption)
                    .foregroundColor(.mkMuted)
                    .multilineTextAlignment(.center)
            }
            MKTextField(placeholder: "6-digit code", text: $resetCode, icon: "number.circle.fill")
            MKTextField(placeholder: "New password", text: $resetNewPass, icon: "lock.fill", isSecure: true)
            feedbackView
            MKButton(label: isLoading ? "Resetting…" : "Reset Password",
                     icon: "checkmark.circle.fill", isLoading: isLoading) {
                Task { await submitReset() }
            }
            Button { withAnimation { resetStep = .enterEmail; clearMessages() } } label: {
                Text("← Re-send code").font(.system(size: 13)).foregroundColor(.mkMuted)
            }
        }
    }

    @ViewBuilder
    var feedbackView: some View {
        if let err = errorMsg {
            Text(err).font(.caption).foregroundColor(.mkAccent)
                .multilineTextAlignment(.center).padding(.horizontal, 4)
        } else if let ok = successMsg {
            Text(ok).font(.caption).foregroundColor(Color(red: 0.1, green: 0.8, blue: 0.5))
                .multilineTextAlignment(.center).padding(.horizontal, 4)
        }
    }

    func clearMessages() { errorMsg = nil; successMsg = nil }

    // MARK: Auth

    func authenticate() async {
        let trimmedUser = username.trimmingCharacters(in: .whitespaces)
        guard !trimmedUser.isEmpty, !password.isEmpty else {
            errorMsg = "Please fill in both fields."; return
        }
        isLoading = true; clearMessages()
        do {
            var body: [String: Any] = ["username": trimmedUser, "password": password]
            if mode == .register, !registerEmail.isEmpty { body["email"] = registerEmail }
            let resp: AuthResponse = try await APIService.shared.post(
                mode == .login ? "/login" : "/register", body: body
            )
            if let t = resp.token {
                app.saveSession(token: t, username: trimmedUser, isNewUser: mode == .register)
            } else {
                errorMsg = resp.error ?? "Authentication failed."
            }
        } catch {
            errorMsg = (error as? APIError)?.errorDescription ?? "Network error."
        }
        isLoading = false
    }

    // MARK: Password Reset

    func sendResetCode() async {
        guard !resetEmail.isEmpty else { errorMsg = "Enter your email address."; return }
        isLoading = true; clearMessages()
        do {
            let resp: ForgotPasswordResponse = try await APIService.shared.post(
                "/auth/forgot-password", body: ["email": resetEmail]
            )
            _ = resp
            successMsg = "Code sent! Check your email."
            withAnimation { resetStep = .enterCode }
        } catch {
            // Backend always returns 200 so any error is a network issue
            errorMsg = (error as? APIError)?.errorDescription ?? "Network error."
        }
        isLoading = false
    }

    func submitReset() async {
        guard !resetCode.isEmpty, !resetNewPass.isEmpty else {
            errorMsg = "Enter both the code and a new password."; return
        }
        isLoading = true; clearMessages()
        do {
            let resp: ForgotPasswordResponse = try await APIService.shared.post(
                "/auth/reset-password",
                body: ["email": resetEmail, "code": resetCode, "newPassword": resetNewPass]
            )
            if resp.success == true {
                successMsg = "Password reset! Sign in with your new password."
                withAnimation { resetStep = .none; mode = .login }
                resetCode = ""; resetNewPass = ""
            } else {
                errorMsg = resp.error ?? "Invalid code or it has expired."
            }
        } catch {
            errorMsg = (error as? APIError)?.errorDescription ?? "Network error."
        }
        isLoading = false
    }
}

// MARK: - Platforms

struct PlatformsView: View {
    @EnvironmentObject var app: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var selected: Set<String> = []
    @State private var selectedLangs: Set<String> = []
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
                        VStack(spacing: 4) {
                            HStack(spacing: 4) {
                                Text("Select every service you subscribe to.")
                                    .font(.subheadline)
                                    .foregroundColor(.mkMuted)
                                    .multilineTextAlignment(.center)
                            }
                            HStack(spacing: 5) {
                                Image("StreamScoreLogo")
                                    .resizable()
                                    .scaledToFit()
                                    .frame(width: 16, height: 16)
                                    .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
                                Text("StreamScout")
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundColor(.mkAccent)
                                Text("will show titles available across your chosen platforms.")
                                    .font(.subheadline)
                                    .foregroundColor(.mkMuted)
                            }
                            .multilineTextAlignment(.center)
                        }
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

                        // Language selection
                        VStack(alignment: .leading, spacing: 12) {
                            Divider().overlay(Color.mkBorder).padding(.horizontal, 16)
                            VStack(alignment: .leading, spacing: 3) {
                                Text("LANGUAGES")
                                    .font(.system(size: 11, weight: .semibold))
                                    .foregroundColor(.mkAccent)
                                    .kerning(1.4)
                                Text("Include titles in these languages (optional)")
                                    .font(.caption)
                                    .foregroundColor(.mkMuted)
                            }
                            .padding(.horizontal, 16)
                            let langCols = Array(repeating: GridItem(.flexible(), spacing: 10), count: 3)
                            LazyVGrid(columns: langCols, spacing: 10) {
                                ForEach(allLanguages) { lang in
                                    let isOn = selectedLangs.contains(lang.key)
                                    Button {
                                        withAnimation(.spring(duration: 0.2)) {
                                            if isOn { selectedLangs.remove(lang.key) }
                                            else    { selectedLangs.insert(lang.key) }
                                        }
                                    } label: {
                                        Text(lang.label)
                                            .font(.system(size: 12, weight: .semibold))
                                            .lineLimit(1).minimumScaleFactor(0.8)
                                            .frame(maxWidth: .infinity, minHeight: 38)
                                            .foregroundColor(isOn ? .mkAccent : .mkMuted)
                                            .background(
                                                RoundedRectangle(cornerRadius: 10)
                                                    .fill(isOn ? Color.mkAccent.opacity(0.12) : Color.mkSurface)
                                            )
                                            .overlay(
                                                RoundedRectangle(cornerRadius: 10)
                                                    .stroke(isOn ? Color.mkAccent.opacity(0.5) : Color.mkBorder, lineWidth: 1)
                                            )
                                    }
                                    .buttonStyle(ScaleButtonStyle())
                                }
                            }
                            .padding(.horizontal, 16)
                        }

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
            selectedLangs = Set(resp.languages ?? [])
            app.savePlatforms(resp.platforms)
            app.saveLanguages(resp.languages ?? [])
        } catch {
            // Pre-fill with locally cached platforms if network fails
            if !app.selectedPlatforms.isEmpty {
                selected = Set(app.selectedPlatforms)
                selectedLangs = Set(app.selectedLanguages)
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
        let languages = Array(selectedLangs)
        app.savePlatforms(platforms)
        app.saveLanguages(languages)
        do {
            _ = try await APIService.shared.put(
                "/platforms",
                body: ["platforms": platforms, "languages": languages],
                token: app.token
            ) as GenericResponse
        } catch {
            errorMsg = "Couldn't save your services. Changes saved locally — try again later."
        }
        isSaving = false
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
    @State private var selectedDetail: CatalogItem? = nil
    @State private var pollingTask: Task<Void, Never>?
    @State private var searchText = ""
    @State private var searchResults: [CatalogItem] = []
    @State private var isSearchActive = false
    @State private var isSearchLoading = false
    @State private var searchTask: Task<Void, Never>?

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
            searchBar
            if !isSearchActive { filterBar.padding(.bottom, 8) }
            Divider().overlay(Color.mkBorder)

            if isSearchActive {
                searchContent
            } else if isLoading || (movies.isEmpty && meta?.refreshing == true) {
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
                            .font(.system(size: 40)).foregroundColor(.mkAccent)
                        Text("Couldn't load titles")
                            .font(.title3).bold().foregroundColor(.mkMuted)
                        Text(err).font(.subheadline).foregroundColor(.mkMuted.opacity(0.7))
                            .multilineTextAlignment(.center).padding(.horizontal, 40)
                        MKButton(label: "Retry", icon: "arrow.clockwise") { Task { await fetch() } }
                            .frame(maxWidth: 180).padding(.top, 4)
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
                            MovieCardView(movie: movie, onTap: { selectedDetail = movie })
                                .padding(.horizontal, 16)
                        }
                        if totalPages > 1 { paginationBar.padding(.horizontal, 16).padding(.bottom, 24) }
                    }
                    .padding(.top, 12)
                }
            }
        }
        .sheet(isPresented: $showSettingsView) {
            SettingsView().environmentObject(app)
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
            DetailSheet(movie: movie).environmentObject(app)
        }
        .task {
            if app.selectedPlatforms.isEmpty { await loadPlatforms() }
            if app.selectedPlatforms.isEmpty { showSettingsView = true; return }
            await fetch()
            startPollingIfNeeded()
        }
        .onChange(of: showSettingsView) { open in
            if !open { page = 1; Task { await fetch() } }
        }
        .onDisappear { pollingTask?.cancel(); searchTask?.cancel() }
    }

    // MARK: Sub-views

    var topBar: some View {
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text("🎬 STREAMSCOUT")
                    .font(.system(size: 11, weight: .semibold)).kerning(1.2)
                    .foregroundColor(.mkAccent)
                Text("Streaming Catalog")
                    .font(.system(size: 20, weight: .bold)).foregroundColor(.mkText)
            }
            Spacer()
            IconButton(icon: "arrow.clockwise", spinning: isLoading) { Task { await fetch() } }
            IconButton(icon: "gearshape.fill") { showSettingsView = true }
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
                Button { showGenrePicker = true } label: {
                    FilterChip(
                        label: genreFilters.isEmpty ? "Genres" : "\(genreFilters.count) Genre\(genreFilters.count == 1 ? "" : "s")",
                        icon: "theatermasks", active: !genreFilters.isEmpty
                    )
                }
                Button { showLanguagePicker = true } label: {
                    FilterChip(
                        label: languageFilters.isEmpty ? "Language" : "\(languageFilters.count) Lang\(languageFilters.count == 1 ? "" : "s")",
                        icon: "globe", active: !languageFilters.isEmpty
                    )
                }
                Button { showYearFilter = true } label: {
                    FilterChip(
                        label: (yearMin.isEmpty && yearMax.isEmpty) ? "Year" : "\(yearMin.isEmpty ? "…" : yearMin)–\(yearMax.isEmpty ? "…" : yearMax)",
                        icon: "calendar", active: !yearMin.isEmpty || !yearMax.isEmpty
                    )
                }
                if !app.watchedIds.isEmpty {
                    Button {
                        hideWatched.toggle(); page = 1; Task { await fetch() }
                    } label: {
                        FilterChip(
                            label: hideWatched ? "Hiding Watched" : "Hide Watched",
                            icon: "eye.slash", active: hideWatched
                        )
                    }
                }
                Button {
                    watchlistOnly.toggle(); page = 1; Task { await fetch() }
                } label: {
                    FilterChip(
                        label: "From Watchlist",
                        icon: "bookmark.fill", active: watchlistOnly
                    )
                }
                if !app.selectedPlatforms.isEmpty {
                    HStack(spacing: 5) {
                        Image(systemName: "play.rectangle.on.rectangle").font(.system(size: 10))
                        Text("\(app.selectedPlatforms.count) services").font(.system(size: 12))
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
                .onChange(of: searchText) { text in
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
        .background(Color.mkSurface)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
    }

    var searchContent: some View {
        Group {
            if isSearchLoading {
                Spacer()
                ProgressView().tint(.mkAccent)
                Spacer()
            } else if searchResults.isEmpty {
                Spacer()
                VStack(spacing: 8) {
                    Image(systemName: "magnifyingglass").font(.system(size: 32)).foregroundColor(.mkMuted.opacity(0.5))
                    Text("No results for \"\(searchText)\"")
                        .font(.subheadline).foregroundColor(.mkMuted)
                }
                Spacer()
            } else {
                ScrollView {
                    LazyVStack(spacing: 12) {
                        ForEach(searchResults) { movie in
                            MovieCardView(movie: movie, onTap: { selectedDetail = movie })
                                .padding(.horizontal, 16)
                        }
                    }
                    .padding(.top, 12).padding(.bottom, 24)
                }
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
        default: return "Popularity"
        }
    }

    // MARK: Networking

    @MainActor func loadPlatforms() async {
        do {
            let resp: PlatformResponse = try await APIService.shared.get("/platforms", token: app.token)
            app.savePlatforms(resp.platforms)
        } catch { }
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
        if watchlistOnly { params["watchlistOnly"] = "true" }
        do {
            let resp: CatalogResponse = try await APIService.shared.get("/movies", params: params, token: app.token)
            if let serverError = resp.error, resp.catalog.isEmpty {
                errorMsg = serverError; isLoading = false; return
            }
            movies     = resp.catalog
            meta       = resp.meta
            totalPages = resp.meta?.totalPages ?? max(1, Int(ceil(Double(resp.meta?.resultCount ?? 0) / 24.0)))
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
        } catch { }
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
// MARK: - Movie Card

struct MovieCardView: View {
    let movie: CatalogItem
    var onTap: () -> Void = {}
    @EnvironmentObject var app: AppState
    @State private var isTogglingWatched = false
    var isTV: Bool { movie.mediaType == "tv" }
    var isWatched: Bool { app.watchedIds.contains(movie.id) }
    var mediaType: String { movie.mediaType ?? "movie" }
    var tmdbId: String {
        let parts = movie.id.split(separator: "-")
        return parts.count >= 2 ? String(parts.last!) : movie.id
    }

    var body: some View {
        Button(action: onTap) {
            HStack(alignment: .top, spacing: 14) {
                posterView
                infoColumn
            }
            .padding(14)
            .background(Color.mkCard)
            .clipShape(RoundedRectangle(cornerRadius: 18))
            .overlay(RoundedRectangle(cornerRadius: 18).stroke(Color.mkBorder, lineWidth: 1))
            .overlay(accentBar)
            .overlay(watchedToggleButton, alignment: .topTrailing)
        }
        .buttonStyle(.plain)
    }

    var watchedToggleButton: some View {
        Button { Task { await toggleWatched() } } label: {
            Group {
                if isTogglingWatched {
                    ProgressView().scaleEffect(0.65).tint(.green)
                        .frame(width: 22, height: 22)
                } else {
                    Image(systemName: isWatched ? "checkmark.circle.fill" : "circle")
                        .font(.system(size: 22))
                        .foregroundColor(isWatched ? .green : .mkMuted.opacity(0.6))
                }
            }
            .background(Circle().fill(Color.mkCard).padding(2))
            .padding(8)
        }
        .buttonStyle(.plain)
        .disabled(isTogglingWatched)
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
    var body: some View {
        Text(text)
            .font(.system(size: 10, weight: .semibold))
            .kerning(0.2)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(color.opacity(0.13))
            .foregroundColor(color)
            .clipShape(Capsule())
            .overlay(Capsule().stroke(color.opacity(0.25), lineWidth: 1))
    }
}

// Streaming provider chips — neutral pill, clearly a "service" tag
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
                .font(.system(size: 10, weight: .semibold))
                .foregroundColor(.mkText.opacity(0.9))
        }
        .padding(.horizontal, 9).padding(.vertical, 4)
        .background(Color.white.opacity(0.07))
        .clipShape(Capsule())
        .overlay(Capsule().stroke(Color.white.opacity(0.18), lineWidth: 1))
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
                Text(entry.label).font(.system(size: 8)).foregroundColor(entry.color.opacity(0.8))
                Text(entry.value).font(.system(size: 11, weight: .bold)).foregroundColor(.mkText)
            }
        }
        .padding(.horizontal, 8).padding(.vertical, 5)
        .background(entry.color.opacity(0.12))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(entry.color.opacity(0.45), lineWidth: 1))
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

// MARK: - Language Picker Sheet

struct LanguagePickerSheet: View {
    @Binding var selected: Set<String>
    let available: [String]   // languages the user has set up
    @Environment(\.dismiss) private var dismiss
    let onApply: () -> Void

    // Show only languages the user has configured; fall back to all if none set
    var displayLanguages: [AppLanguage] {
        available.isEmpty
            ? allLanguages
            : allLanguages.filter { available.contains($0.key) }
    }

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 10), count: 3)

    var body: some View {
        NavigationView {
            ZStack {
                Color.mkBackground.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        Text("Filter titles to show only selected languages.")
                            .font(.subheadline)
                            .foregroundColor(.mkMuted)
                            .padding(.horizontal, 20)
                            .padding(.top, 4)

                        LazyVGrid(columns: columns, spacing: 10) {
                            ForEach(displayLanguages) { lang in
                                let isOn = selected.contains(lang.key)
                                Button {
                                    withAnimation(.spring(duration: 0.2)) {
                                        if isOn { selected.remove(lang.key) }
                                        else    { selected.insert(lang.key) }
                                    }
                                } label: {
                                    Text(lang.label)
                                        .font(.system(size: 13, weight: .semibold))
                                        .multilineTextAlignment(.center)
                                        .lineLimit(2).minimumScaleFactor(0.8)
                                        .frame(maxWidth: .infinity, minHeight: 48)
                                        .foregroundColor(isOn ? .white : .mkMuted)
                                        .background(
                                            RoundedRectangle(cornerRadius: 12)
                                                .fill(isOn
                                                    ? Color.mkAccent.opacity(0.28)
                                                    : Color.mkSurface)
                                        )
                                        .overlay(
                                            RoundedRectangle(cornerRadius: 12)
                                                .stroke(isOn
                                                    ? Color.mkAccent.opacity(0.6)
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
                                Label("Clear Language Filter", systemImage: "xmark.circle")
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
            .navigationTitle("Filter by Language")
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

// MARK: - Range Slider

struct RangeSlider: View {
    @Binding var low: Double
    @Binding var high: Double
    let bounds: ClosedRange<Double>
    let step: Double

    private let thumbDiameter: CGFloat = 26

    var body: some View {
        GeometryReader { geo in
            let trackWidth = geo.size.width - thumbDiameter
            let lowOffset  = CGFloat((low  - bounds.lowerBound) / (bounds.upperBound - bounds.lowerBound)) * trackWidth
            let highOffset = CGFloat((high - bounds.lowerBound) / (bounds.upperBound - bounds.lowerBound)) * trackWidth

            ZStack(alignment: .leading) {
                // Background track
                Capsule()
                    .fill(Color.mkBorder)
                    .frame(height: 4)
                    .padding(.horizontal, thumbDiameter / 2)

                // Active range fill
                Capsule()
                    .fill(Color.mkAccent)
                    .frame(width: max(0, highOffset - lowOffset), height: 4)
                    .padding(.leading, thumbDiameter / 2 + lowOffset)

                // Low thumb
                Circle()
                    .fill(Color.mkAccent)
                    .frame(width: thumbDiameter, height: thumbDiameter)
                    .shadow(color: Color.mkAccent.opacity(0.4), radius: 5)
                    .offset(x: lowOffset)
                    .gesture(
                        DragGesture(minimumDistance: 0, coordinateSpace: .named("rangeTrack"))
                            .onChanged { drag in
                                let val = snapValue(x: drag.location.x, trackWidth: trackWidth)
                                low = min(max(val, bounds.lowerBound), high - step)
                            }
                    )
                    .zIndex(lowOffset >= highOffset - 1 ? 1 : 0)

                // High thumb
                Circle()
                    .fill(Color.mkAccent)
                    .frame(width: thumbDiameter, height: thumbDiameter)
                    .shadow(color: Color.mkAccent.opacity(0.4), radius: 5)
                    .offset(x: highOffset)
                    .gesture(
                        DragGesture(minimumDistance: 0, coordinateSpace: .named("rangeTrack"))
                            .onChanged { drag in
                                let val = snapValue(x: drag.location.x, trackWidth: trackWidth)
                                high = max(min(val, bounds.upperBound), low + step)
                            }
                    )
            }
            .coordinateSpace(name: "rangeTrack")
        }
        .frame(height: thumbDiameter)
    }

    private func snapValue(x: CGFloat, trackWidth: CGFloat) -> Double {
        let pct = Double(max(0, min(x - thumbDiameter / 2, trackWidth)) / trackWidth)
        let raw = bounds.lowerBound + pct * (bounds.upperBound - bounds.lowerBound)
        return (raw / step).rounded() * step
    }
}

// MARK: - Year Filter Sheet

struct YearFilterSheet: View {
    @Binding var yearMin: String
    @Binding var yearMax: String
    @Environment(\.dismiss) private var dismiss
    let onApply: () -> Void

    private let minYear: Double = 1900
    private let maxYear: Double = Double(Calendar.current.component(.year, from: Date()))

    @State private var sliderMin: Double = 1900
    @State private var sliderMax: Double = Double(Calendar.current.component(.year, from: Date()))

    var body: some View {
        NavigationView {
            ZStack {
                Color.mkBackground.ignoresSafeArea()
                VStack(spacing: 32) {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("From").font(.caption).foregroundColor(.mkMuted)
                            Text(String(Int(sliderMin)))
                                .font(.system(size: 28, weight: .bold, design: .rounded))
                                .foregroundColor(.mkAccent)
                        }
                        Spacer()
                        Image(systemName: "arrow.left.arrow.right")
                            .font(.system(size: 14)).foregroundColor(.mkMuted)
                        Spacer()
                        VStack(alignment: .trailing, spacing: 2) {
                            Text("To").font(.caption).foregroundColor(.mkMuted)
                            Text(String(Int(sliderMax)))
                                .font(.system(size: 28, weight: .bold, design: .rounded))
                                .foregroundColor(.mkAccent)
                        }
                    }
                    .padding(.horizontal, 24)
                    .padding(.top, 16)

                    RangeSlider(low: $sliderMin, high: $sliderMax, bounds: minYear...maxYear, step: 1)
                        .padding(.horizontal, 24)

                    Button {
                        sliderMin = minYear; sliderMax = maxYear
                        yearMin = ""; yearMax = ""
                    } label: {
                        Label("Reset to All Years", systemImage: "arrow.counterclockwise")
                            .font(.subheadline).foregroundColor(.mkAccent)
                    }

                    Spacer()
                }
            }
            .navigationTitle("Filter by Year")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") { dismiss() }.foregroundColor(.mkMuted)
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Apply") {
                        yearMin = sliderMin > minYear ? String(Int(sliderMin)) : ""
                        yearMax = sliderMax < maxYear ? String(Int(sliderMax)) : ""
                        onApply(); dismiss()
                    }
                    .fontWeight(.semibold).foregroundColor(.mkAccent)
                }
            }
            .onAppear {
                sliderMin = Double(yearMin) ?? minYear
                sliderMax = Double(yearMax) ?? maxYear
            }
        }
    }
}

// MARK: - Detail Sheet

struct DetailSheet: View {
    let movie: CatalogItem
    @EnvironmentObject var app: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var details: TitleDetails?
    @State private var isLoadingExtras = true
    @State private var detailsError: String? = nil
    @State private var isTogglingWatched = false

    var isWatched: Bool { app.watchedIds.contains(movie.id) }
    var mediaType: String { movie.mediaType ?? "movie" }
    var tmdbId: String {
        let parts = movie.id.split(separator: "-")
        return parts.count >= 2 ? String(parts.last!) : movie.id
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Color.mkBackground.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        backdropSection

                        VStack(alignment: .leading, spacing: 16) {
                            // Title + year + type — always available from CatalogItem
                            titleSection

                            // Overview — use CatalogItem value immediately
                            if let overview = movie.overview ?? details?.overview, !overview.isEmpty {
                                detailRow(icon: "text.alignleft", label: "Overview") {
                                    Text(overview)
                                        .font(.system(size: 14)).foregroundColor(.mkMuted)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                            }

                            // Genres — prefer API-enriched list, fallback to CatalogItem
                            let genres = details?.genres ?? movie.genres ?? []
                            if !genres.isEmpty {
                                detailRow(icon: "tag", label: "Genres") {
                                    HStack(spacing: 6) {
                                        ForEach(genres, id: \.self) { PillChip(text: $0, color: .mkMuted) }
                                    }
                                }
                            }

                            // Ratings — all four sources from CatalogItem, no API needed
                            let ratings = buildRatings()
                            if !ratings.isEmpty {
                                detailRow(icon: "star.fill", label: "Ratings") {
                                    HStack(spacing: 8) {
                                        ForEach(ratings, id: \.label) { r in RatingChip(entry: r) }
                                    }
                                }
                            }

                            // Streaming services — from CatalogItem
                            if let providers = movie.availableOn, !providers.isEmpty {
                                detailRow(icon: "play.rectangle.on.rectangle", label: "Available On") {
                                    HStack(spacing: 6) {
                                        ForEach(providers.prefix(6), id: \.self) { ProviderChip(name: $0) }
                                    }
                                }
                            }

                            Divider().overlay(Color.mkBorder)

                            // Extras — loaded from TMDB details endpoint
                            if isLoadingExtras {
                                HStack(spacing: 8) {
                                    ProgressView().scaleEffect(0.8).tint(.mkAccent)
                                    Text("Loading cast & more…")
                                        .font(.caption).foregroundColor(.mkMuted)
                                }
                            } else if let d = details {
                                extrasSection(d)
                            } else if let err = detailsError {
                                Text(err).font(.caption).foregroundColor(.mkMuted).frame(maxWidth: .infinity)
                            }
                        }
                        .padding(.horizontal, 20)
                        .padding(.bottom, 32)
                    }
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button { dismiss() } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 22))
                            .foregroundColor(.mkMuted)
                    }
                }
                ToolbarItem(placement: .navigationBarLeading) {
                    watchedButton
                }
            }
        }
        .task {
            await loadDetails()
            await loadWatched()
        }
    }

    // Reusable labeled section block
    @ViewBuilder
    func detailRow<Content: View>(icon: String, label: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(label, systemImage: icon)
                .font(.system(size: 13, weight: .semibold)).foregroundColor(.mkAccent)
            content()
        }
    }

    var backdropSection: some View {
        Group {
            if let urlStr = details?.backdropUrl ?? movie.posterUrl, let url = URL(string: urlStr) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let img):
                        ZStack {
                            // Blurred background fills letterbox gaps for portrait posters
                            img.resizable().scaledToFill()
                                .frame(maxWidth: .infinity).frame(height: 220)
                                .clipped()
                                .blur(radius: 16)
                                .opacity(0.4)
                            // Sharp centered image
                            img.resizable().scaledToFit()
                                .frame(maxHeight: 210)
                                .shadow(color: .black.opacity(0.45), radius: 8, x: 0, y: 4)
                        }
                        .frame(maxWidth: .infinity).frame(height: 220)
                        .clipped()
                        .overlay(
                            LinearGradient(
                                gradient: Gradient(colors: [.clear, Color.mkBackground.opacity(0.85), Color.mkBackground]),
                                startPoint: .top, endPoint: .bottom
                            )
                        )
                    default:
                        Color.mkSurface.frame(height: 180)
                    }
                }
            } else {
                Color.mkSurface.frame(height: 120)
            }
        }
    }

    var titleSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(movie.title)
                .font(.system(size: 22, weight: .bold))
                .foregroundColor(.mkText)
            HStack(spacing: 8) {
                TypeChip(label: (movie.mediaType ?? "movie") == "tv" ? "TV" : "Film",
                         isTV: (movie.mediaType ?? "movie") == "tv")
                if let y = movie.year { PillChip(text: String(y), color: .mkMuted) }
                if let t = details?.tagline, !t.isEmpty {
                    Text("· \(t)").font(.caption).foregroundColor(.mkMuted).lineLimit(1)
                }
            }
        }
    }

    @ViewBuilder
    func extrasSection(_ d: TitleDetails) -> some View {
        // Runtime (movies) or seasons (TV)
        if let runtime = d.runtime, runtime > 0 {
            HStack(spacing: 8) {
                Image(systemName: "clock").foregroundColor(.mkAccent).font(.system(size: 13))
                Text("Runtime").font(.system(size: 13, weight: .semibold)).foregroundColor(.mkMuted)
                Text("\(runtime) min").font(.system(size: 14)).foregroundColor(.mkText)
            }
        } else if let seasons = d.numberOfSeasons {
            HStack(spacing: 8) {
                Image(systemName: "tv").foregroundColor(.mkAccent).font(.system(size: 13))
                Text("Seasons").font(.system(size: 13, weight: .semibold)).foregroundColor(.mkMuted)
                Text("\(seasons)").font(.system(size: 14)).foregroundColor(.mkText)
            }
        }
        // Director / Creator
        if let directors = d.directors, !directors.isEmpty {
            HStack(spacing: 8) {
                Image(systemName: "camera.fill").foregroundColor(.mkAccent).font(.system(size: 13))
                Text(mediaType == "tv" ? "Creator" : "Director")
                    .font(.system(size: 13, weight: .semibold)).foregroundColor(.mkMuted)
                Text(directors.joined(separator: ", ")).font(.system(size: 14)).foregroundColor(.mkText)
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

    var watchedButton: some View {
        Button { Task { await toggleWatched() } } label: {
            HStack(spacing: 5) {
                if isTogglingWatched {
                    ProgressView().scaleEffect(0.75).tint(isWatched ? .mkMuted : .green)
                } else {
                    Image(systemName: isWatched ? "checkmark.circle.fill" : "circle")
                        .foregroundColor(isWatched ? .green : .mkMuted)
                }
                Text(isWatched ? "Watched" : "Mark Watched")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(isWatched ? .green : .mkMuted)
            }
        }
        .disabled(isTogglingWatched)
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
        } catch { }
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
                        AsyncImage(url: url) { phase in
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
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(.mkText).lineLimit(2).multilineTextAlignment(.center)
                    .frame(width: 64)
                if !member.character.isEmpty {
                    Text(member.character).font(.system(size: 10)).foregroundColor(.mkMuted)
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
    @EnvironmentObject var app: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var items: [CatalogItem] = []
    @State private var isLoading = true
    @State private var errorMsg: String?

    var body: some View {
        NavigationView {
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
            AsyncImage(url: URL(string: item.posterUrl ?? "")) { phase in
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
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(.mkText).lineLimit(2)
                .frame(width: 110, alignment: .leading)
            if let year = item.year {
                Text(String(year)).font(.system(size: 10)).foregroundColor(.mkMuted)
            }
        }
    }
}

// MARK: - Settings View

struct SettingsView: View {
    enum Tab: String { case services, profile, watched, watchlistTab }
    @EnvironmentObject var app: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var tab: Tab = .services

    var body: some View {
        NavigationStack {
            ZStack {
                Color.mkBackground.ignoresSafeArea()
                VStack(spacing: 0) {
                    tabPicker.padding(.horizontal, 16).padding(.vertical, 10)
                    Divider().overlay(Color.mkBorder)
                    Group {
                        switch tab {
                        case .services:    ServicesTabView().environmentObject(app)
                        case .profile:     ProfileTabView().environmentObject(app)
                        case .watched:     WatchedOnlyTabView().environmentObject(app)
                        case .watchlistTab: WatchlistOnlyTabView().environmentObject(app)
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .animation(.easeInOut(duration: 0.2), value: tab)
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") { dismiss() }.fontWeight(.semibold).foregroundColor(.mkAccent)
                }
            }
        }
    }

    var tabPicker: some View {
        HStack(spacing: 0) {
            ForEach([(Tab.services, "play.rectangle.on.rectangle", "Services"),
                     (Tab.profile, "person.crop.circle", "Profile"),
                     (Tab.watched, "checkmark.circle", "Watched"),
                     (Tab.watchlistTab, "bookmark.circle", "Watchlist")], id: \.0.rawValue) { t, icon, label in
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) { tab = t }
                } label: {
                    VStack(spacing: 4) {
                        Image(systemName: icon).font(.system(size: 16))
                        Text(label).font(.system(size: 12, weight: .semibold))
                    }
                    .foregroundColor(tab == t ? .mkAccent : .mkMuted)
                    .frame(maxWidth: .infinity).padding(.vertical, 10)
                    .background(tab == t ? Color.mkAccent.opacity(0.1) : Color.clear)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                }
            }
        }
        .background(Color.mkSurface).clipShape(RoundedRectangle(cornerRadius: 14))
    }
}

// MARK: Services Tab

struct ServicesTabView: View {
    @EnvironmentObject var app: AppState
    @State private var isSaving = false
    @State private var savedMsg = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text("Streaming Services").font(.title3).bold().foregroundColor(.mkText).padding(.top, 4)
                Text("Select every service you subscribe to.").font(.subheadline).foregroundColor(.mkMuted)
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: 3), spacing: 12) {
                    ForEach(allPlatforms) { platform in
                        PlatformToggle(platform: platform, isSelected: app.selectedPlatforms.contains(platform.key)) {
                            let updated = app.selectedPlatforms.contains(platform.key)
                                ? app.selectedPlatforms.filter { $0 != platform.key }
                                : app.selectedPlatforms + [platform.key]
                            app.savePlatforms(updated)
                        }
                    }
                }
                .padding(.horizontal, 2)
                Text("Content Languages").font(.title3).bold().foregroundColor(.mkText)
                Text("Filter catalog by language preference.").font(.subheadline).foregroundColor(.mkMuted)
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: 3), spacing: 12) {
                    ForEach(allLanguages) { lang in
                        LanguageToggle(language: lang, isSelected: app.selectedLanguages.contains(lang.key)) {
                            let updated = app.selectedLanguages.contains(lang.key)
                                ? app.selectedLanguages.filter { $0 != lang.key }
                                : app.selectedLanguages + [lang.key]
                            app.saveLanguages(updated)
                        }
                    }
                }
                .padding(.horizontal, 2)
                if !savedMsg.isEmpty {
                    Text(savedMsg).font(.subheadline).foregroundColor(.green).frame(maxWidth: .infinity)
                }
                MKButton(label: "Save Services", icon: "checkmark.circle.fill", isLoading: isSaving) {
                    Task { await saveServices() }
                }
                .padding(.bottom, 24)
            }
            .padding(.horizontal, 16).padding(.top, 12)
        }
    }

    @MainActor func saveServices() async {
        isSaving = true
        do {
            let body: [String: Any] = [
                "platforms": app.selectedPlatforms,
                "languages": app.selectedLanguages
            ]
            let _: GenericResponse = try await APIService.shared.put("/platforms", body: body, token: app.token)
            savedMsg = "Saved ✓"
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { savedMsg = "" }
        } catch { savedMsg = "Save failed" }
        isSaving = false
    }
}

struct PlatformToggle: View {
    let platform: StreamingPlatform
    let isSelected: Bool
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            VStack(spacing: 6) {
                Image(platform.logoAsset).resizable().scaledToFit()
                    .frame(width: 44, height: 44)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .overlay(RoundedRectangle(cornerRadius: 10)
                        .stroke(isSelected ? Color.mkAccent : Color.clear, lineWidth: 2))
                Text(platform.name).font(.system(size: 11, weight: .semibold))
                    .foregroundColor(isSelected ? .mkAccent : .mkMuted)
                    .lineLimit(1).minimumScaleFactor(0.7)
                    .frame(maxWidth: .infinity)
            }
            .padding(10)
            .frame(maxWidth: .infinity, minHeight: 80)
            .background(isSelected ? Color.mkAccent.opacity(0.1) : Color.mkSurface)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(
                isSelected ? Color.mkAccent.opacity(0.5) : Color.mkBorder, lineWidth: 1))
        }
        .buttonStyle(ScaleButtonStyle())
    }
}

struct LanguageToggle: View {
    let language: AppLanguage
    let isSelected: Bool
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(language.label)
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(isSelected ? .mkAccent : .mkMuted)
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(isSelected ? Color.mkAccent.opacity(0.12) : Color.mkSurface)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(
                    isSelected ? Color.mkAccent.opacity(0.5) : Color.mkBorder, lineWidth: 1))
        }
        .buttonStyle(ScaleButtonStyle())
    }
}

// MARK: Profile Tab

struct ProfileTabView: View {
    @EnvironmentObject var app: AppState
    @State private var username = ""
    @State private var email = ""
    @State private var currentPassword = ""
    @State private var newPassword = ""
    @State private var isSaving = false
    @State private var message = ""
    @State private var messageIsError = false
    @State private var avatarItem: PhotosPickerItem?
    @State private var avatarUIImage: UIImage?
    @State private var profilePicBase64: String?
    @State private var isLoadingAccount = true
    // Letterboxd import
    @State private var showFileImporter = false
    @State private var lbxIntendedType = "watched"
    @State private var lbxImportType = ""
    @State private var lbxItems: [[String: Any]] = []
    @State private var showLbxConfirm = false
    @State private var showLbxMismatch = false
    @State private var lbxImportProgress: String? = nil
    @State private var lbxImportDone: String? = nil
    // Catalog refresh
    @State private var showRefreshConfirm = false
    @State private var isRefreshing = false

    var body: some View {
        ScrollView {
            if isLoadingAccount {
                ProgressView().padding(.top, 60).frame(maxWidth: .infinity)
            } else {
            VStack(spacing: 20) {
                avatarSection
                VStack(spacing: 14) {
                    MKTextField(placeholder: "Username", text: $username, icon: "person")
                    MKTextField(placeholder: "Email address", text: $email, icon: "envelope")
                    Divider().overlay(Color.mkBorder)
                    Text("Change Password").font(.subheadline).foregroundColor(.mkMuted).frame(maxWidth: .infinity, alignment: .leading)
                    MKTextField(placeholder: "Current password", text: $currentPassword, icon: "lock", isSecure: true)
                    MKTextField(placeholder: "New password", text: $newPassword, icon: "lock.open", isSecure: true)
                }
                if !message.isEmpty {
                    Text(message)
                        .font(.subheadline)
                        .foregroundColor(messageIsError ? .red : .green)
                        .frame(maxWidth: .infinity)
                }
                MKButton(label: "Save Changes", icon: "checkmark.circle.fill", isLoading: isSaving) {
                    Task { await saveProfile() }
                }

                Divider().overlay(Color.mkBorder)

                // ── Letterboxd Import ──────────────────────────────────────
                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 8) {
                        Image(systemName: "square.and.arrow.down")
                            .foregroundColor(.mkAccent)
                        Text("Letterboxd Import")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundColor(.mkText)
                    }
                    Text("Export your watched.csv or watchlist.csv from Letterboxd (letterboxd.com/settings/data) and use the matching button above.")
                        .font(.caption)
                        .foregroundColor(.mkMuted)
                        .fixedSize(horizontal: false, vertical: true)

                    if let progress = lbxImportProgress {
                        HStack(spacing: 8) {
                            ProgressView().tint(.mkAccent).scaleEffect(0.8)
                            Text(progress).font(.caption).foregroundColor(.mkMuted)
                        }
                    } else if let done = lbxImportDone {
                        Text(done).font(.caption).foregroundColor(.green)
                    }

                    HStack(spacing: 10) {
                        MKButton(label: "Import Watched", icon: "eye.fill", isLoading: lbxImportProgress != nil) {
                            lbxIntendedType = "watched"
                            showFileImporter = true
                        }
                        MKButton(label: "Import Watchlist", icon: "bookmark.fill", isLoading: lbxImportProgress != nil) {
                            lbxIntendedType = "watchlist"
                            showFileImporter = true
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.bottom, 8)

                Divider().overlay(Color.mkBorder)

                // ── Catalog Refresh ────────────────────────────────────────
                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 8) {
                        Image(systemName: "arrow.clockwise.circle")
                            .foregroundColor(.mkAccent)
                        Text("Catalog Refresh")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundColor(.mkText)
                    }
                    Text("Re-fetch all streaming content from the API. Use this if your catalog looks out of date. It may take a few minutes.")
                        .font(.caption)
                        .foregroundColor(.mkMuted)
                        .fixedSize(horizontal: false, vertical: true)
                    MKButton(
                        label: isRefreshing ? "Starting…" : "Refresh Catalog",
                        icon: "arrow.clockwise.circle.fill",
                        isLoading: isRefreshing
                    ) {
                        showRefreshConfirm = true
                    }
                    .disabled(app.selectedPlatforms.isEmpty)
                    if app.selectedPlatforms.isEmpty {
                        Text("Add streaming services first.")
                            .font(.caption).foregroundColor(.mkMuted)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.bottom, 24)
            }
            .padding(.horizontal, 16).padding(.top, 12)
            } // end else
        }
        .task { await loadAccount() }
        .onChange(of: avatarItem) { item in
            Task { await loadAvatar(from: item) }
        }
        .fileImporter(
            isPresented: $showFileImporter,
            allowedContentTypes: [.commaSeparatedText, .plainText, .data],
            allowsMultipleSelection: false
        ) { result in
            guard let url = try? result.get().first else { return }
            Task { await handleLetterboxdFile(url: url) }
        }
        .alert(
            lbxImportType == "watched"
                ? "Import \(lbxItems.count) Watched Movies?"
                : "Import \(lbxItems.count) Watchlist Movies?",
            isPresented: $showLbxConfirm
        ) {
            Button("Import") { Task { await runLetterboxdImport() } }
            Button("Cancel", role: .cancel) { }
        } message: {
            Text(lbxImportType == "watched"
                ? "These will be added to your watched history."
                : "These will be saved to your watchlist.")
        }
        .alert("CSV Type Mismatch", isPresented: $showLbxMismatch) {
            Button("Import as \(lbxImportType == "watched" ? "Watched" : "Watchlist")") { showLbxConfirm = true }
            Button("Cancel", role: .cancel) { lbxItems = [] }
        } message: {
            Text("This file looks like a \(lbxImportType == "watched" ? "watchlist" : "watched history") CSV. Are you sure you want to import it as \(lbxImportType == "watched" ? "watched movies" : "your watchlist")?")
        }
        .alert("Refresh Catalog?", isPresented: $showRefreshConfirm) {
            Button("Refresh", role: .destructive) { Task { await refreshCatalog() } }
            Button("Cancel", role: .cancel) { }
        } message: {
            Text("This will re-fetch all streaming content from the API. It may take a few minutes.")
        }
    }

    @MainActor func handleLetterboxdFile(url: URL) async {
        lbxImportDone = nil
        lbxImportProgress = "Reading file…"
        let accessed = url.startAccessingSecurityScopedResource()
        defer { if accessed { url.stopAccessingSecurityScopedResource() } }
        guard let text = try? String(contentsOf: url, encoding: .utf8) else {
            lbxImportProgress = nil
            lbxImportDone = "⚠ Could not read file"
            return
        }
        lbxImportProgress = "Parsing CSV…"
        do {
            let resp: LetterboxdPreviewResult = try await APIService.shared.post(
                "/import/letterboxd/preview",
                body: ["csvText": text, "fileName": url.lastPathComponent],
                token: app.token
            )
            let detectedType = resp.importType ?? "watched"
            lbxImportType = lbxIntendedType  // always use the button the user pressed
            lbxItems = resp.items.map { item in ["name": item.name, "year": item.year] }
            lbxImportProgress = nil
            if lbxItems.isEmpty {
                lbxImportDone = "No valid rows found in CSV"
            } else if detectedType != lbxIntendedType {
                showLbxMismatch = true  // warn before confirming
            } else {
                showLbxConfirm = true
            }
        } catch {
            lbxImportProgress = nil
            lbxImportDone = "⚠ \((error as? APIError)?.errorDescription ?? "Preview failed")"
        }
    }

    @MainActor func runLetterboxdImport() async {
        let batchSize = 50
        var offset = 0
        var totalMatched = 0
        var totalNotFound = 0

        while offset < lbxItems.count {
            let chunk = Array(lbxItems[offset..<min(offset + batchSize, lbxItems.count)])
            lbxImportProgress = "Importing \(offset + chunk.count) of \(lbxItems.count)…"

            let encodableChunk: [[String: Any]] = chunk.compactMap { item in
                guard let name = item["name"] as? String, let year = item["year"] as? Int else { return nil }
                return ["name": name, "year": year]
            }

            do {
                let resp: LetterboxdImportResponse = try await APIService.shared.post(
                    "/import/letterboxd",
                    body: ["items": encodableChunk, "importType": lbxImportType],
                    token: app.token
                )
                totalMatched  += resp.matched ?? 0
                totalNotFound += resp.notFound ?? 0
            } catch { break }

            offset += batchSize
        }

        // Update local watchlist IDs so filter chip appears immediately
        if lbxImportType == "watchlist" {
            // Reload watchlist IDs by fetching from server
            if let resp = try? await APIService.shared.get("/watchlist", token: app.token) as WatchlistResponse {
                for item in resp.items ?? [] { app.setWatchlisted(item.itemId, on: true) }
            }
        } else {
            // Reload watched IDs
            if let resp = try? await APIService.shared.get("/watched", token: app.token) as WatchedListResponse {
                for item in resp.items ?? [] { app.setWatched(item.itemId, watched: true) }
            }
        }

        lbxImportProgress = nil
        lbxImportDone = "✓ Imported \(totalMatched) of \(lbxItems.count) movies\(totalNotFound > 0 ? " (\(totalNotFound) not found)" : "")"
        lbxItems = []
    }

    var avatarSection: some View {
        VStack(spacing: 10) {
            ZStack {
                if let img = avatarUIImage {
                    Image(uiImage: img).resizable().scaledToFill()
                } else {
                    Image(systemName: "person.circle.fill")
                        .resizable().foregroundColor(.mkMuted.opacity(0.5))
                }
            }
            .frame(width: 88, height: 88)
            .clipShape(Circle())
            .overlay(Circle().stroke(Color.mkAccent.opacity(0.4), lineWidth: 2))
            PhotosPicker(selection: $avatarItem, matching: .images) {
                Label("Change Photo", systemImage: "camera.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(.mkAccent)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 8)
    }

    @MainActor func loadAccount() async {
        isLoadingAccount = true
        do {
            let info: AccountInfo = try await APIService.shared.get("/account", token: app.token)
            username = info.username ?? ""
            email = info.email ?? ""
            if let pic = info.profilePic, pic.hasPrefix("data:image/"),
               let data = Data(base64Encoded: pic.components(separatedBy: ",").last ?? ""),
               let img = UIImage(data: data) {
                avatarUIImage = img
            }
        } catch { }
        isLoadingAccount = false
    }

    @MainActor func loadAvatar(from item: PhotosPickerItem?) async {
        guard let item else { return }
        guard let data = try? await item.loadTransferable(type: Data.self),
              let srcImg = UIImage(data: data) else { return }
        let size = CGSize(width: 256, height: 256)
        let renderer = UIGraphicsImageRenderer(size: size)
        let resized = renderer.image { _ in srcImg.draw(in: CGRect(origin: .zero, size: size)) }
        avatarUIImage = resized
        if let jpegData = resized.jpegData(compressionQuality: 0.8) {
            profilePicBase64 = "data:image/jpeg;base64," + jpegData.base64EncodedString()
        }
    }

    @MainActor func saveProfile() async {
        isSaving = true; message = ""; messageIsError = false
        var body: [String: String] = [:]
        let trimUser = username.trimmingCharacters(in: .whitespaces)
        let trimEmail = email.trimmingCharacters(in: .whitespaces)
        if !trimUser.isEmpty  { body["username"] = trimUser }
        if !trimEmail.isEmpty { body["email"] = trimEmail }
        if !newPassword.isEmpty {
            if currentPassword.isEmpty {
                message = "Enter your current password to change it"; messageIsError = true
                isSaving = false; return
            }
            body["currentPassword"] = currentPassword
            body["newPassword"] = newPassword
        }
        if let pic = profilePicBase64 { body["profilePic"] = pic }
        do {
            let resp: UpdateAccountResponse = try await APIService.shared.put("/account", body: body, token: app.token)
            if let newToken = resp.token { app.updateToken(newToken) }
            if let newUser = body["username"] { app.updateUsername(newUser) }
            message = "Saved ✓"; messageIsError = false
            currentPassword = ""; newPassword = ""
        } catch {
            message = (error as? APIError)?.errorDescription ?? "Update failed"
            messageIsError = true
        }
        isSaving = false
    }

    @MainActor func refreshCatalog() async {
        isRefreshing = true
        do {
            let _: SimpleResponse = try await APIService.shared.post("/catalog/refresh", body: [:], token: app.token)
            message = "Catalog refresh started. It may take a few minutes."; messageIsError = false
        } catch {
            message = (error as? APIError)?.errorDescription ?? "Refresh failed"; messageIsError = true
        }
        isRefreshing = false
    }
}

// MARK: Watched Tab

struct WatchedOnlyTabView: View {
    @EnvironmentObject var app: AppState
    @State private var items: [WatchedItem] = []
    @State private var isLoading = true

    var body: some View {
        Group {
            if isLoading {
                VStack { Spacer(); ProgressView().tint(.mkAccent); Spacer() }
            } else if items.isEmpty {
                VStack(spacing: 12) {
                    Spacer()
                    Image(systemName: "checkmark.circle").font(.system(size: 44)).foregroundColor(.mkMuted)
                    Text("Nothing watched yet").font(.title3).bold().foregroundColor(.mkMuted)
                    Text("Mark titles as watched from the catalog, or import your Letterboxd watched.csv in Profile.")
                        .font(.subheadline).foregroundColor(.mkMuted.opacity(0.7))
                        .multilineTextAlignment(.center).padding(.horizontal, 40)
                    Spacer()
                }
            } else {
                List {
                    ForEach(items) { item in
                        watchRow(item.itemId, title: item.title, mediaType: item.mediaType)
                    }
                    .onDelete { offsets in Task { await removeItem(at: offsets) } }
                }
                .listStyle(.plain)
                .background(Color.mkBackground)
            }
        }
        .task { await load() }
    }

    @ViewBuilder
    func watchRow(_ itemId: String, title: String?, mediaType: String?) -> some View {
        HStack(spacing: 12) {
            Image(systemName: (mediaType ?? "movie") == "tv" ? "tv" : "film")
                .foregroundColor(.mkAccent).frame(width: 24)
            VStack(alignment: .leading, spacing: 2) {
                Text(title ?? "Unknown Title").font(.system(size: 15, weight: .semibold)).foregroundColor(.mkText)
                Text((mediaType ?? "movie") == "tv" ? "TV Show" : "Movie")
                    .font(.caption).foregroundColor(.mkMuted)
            }
            Spacer()
            Image(systemName: "checkmark.circle.fill").foregroundColor(.green)
        }
        .listRowBackground(Color.mkSurface)
    }

    @MainActor func load() async {
        isLoading = true
        if let resp: WatchedListResponse = try? await APIService.shared.get("/watched", token: app.token) {
            let loaded = resp.items ?? []
            items = loaded
            app.replaceWatchedIds(loaded.map { $0.itemId })
        }
        isLoading = false
    }

    @MainActor func removeItem(at offsets: IndexSet) async {
        for i in offsets {
            let item = items[i]
            _ = try? await APIService.shared.delete("/watched/\(item.itemId)", token: app.token) as ToggleWatchedResponse
            app.setWatched(item.itemId, watched: false)
        }
        items.remove(atOffsets: offsets)
    }
}

// MARK: Watchlist Tab

struct WatchlistOnlyTabView: View {
    @EnvironmentObject var app: AppState
    @State private var items: [WatchlistItem] = []
    @State private var isLoading = true

    var body: some View {
        Group {
            if isLoading {
                VStack { Spacer(); ProgressView().tint(.mkAccent); Spacer() }
            } else if items.isEmpty {
                VStack(spacing: 12) {
                    Spacer()
                    Image(systemName: "bookmark.circle").font(.system(size: 44)).foregroundColor(.mkMuted)
                    Text("Watchlist is empty").font(.title3).bold().foregroundColor(.mkMuted)
                    Text("Import your Letterboxd watchlist.csv in Profile, or add titles from the catalog.")
                        .font(.subheadline).foregroundColor(.mkMuted.opacity(0.7))
                        .multilineTextAlignment(.center).padding(.horizontal, 40)
                    Spacer()
                }
            } else {
                List {
                    ForEach(items) { item in
                        watchRow(item.itemId, title: item.title, mediaType: item.mediaType)
                    }
                    .onDelete { offsets in Task { await removeItem(at: offsets) } }
                }
                .listStyle(.plain)
                .background(Color.mkBackground)
            }
        }
        .task { await load() }
    }

    @ViewBuilder
    func watchRow(_ itemId: String, title: String?, mediaType: String?) -> some View {
        HStack(spacing: 12) {
            Image(systemName: (mediaType ?? "movie") == "tv" ? "tv" : "film")
                .foregroundColor(.mkAccent).frame(width: 24)
            VStack(alignment: .leading, spacing: 2) {
                Text(title ?? "Unknown Title").font(.system(size: 15, weight: .semibold)).foregroundColor(.mkText)
                Text((mediaType ?? "movie") == "tv" ? "TV Show" : "Movie")
                    .font(.caption).foregroundColor(.mkMuted)
            }
            Spacer()
            Image(systemName: "bookmark.fill").foregroundColor(.mkAccent)
        }
        .listRowBackground(Color.mkSurface)
    }

    @MainActor func load() async {
        isLoading = true
        if let resp: WatchlistResponse = try? await APIService.shared.get("/watchlist", token: app.token) {
            let loaded = resp.items ?? []
            items = loaded
            app.replaceWatchlistIds(loaded.map { $0.itemId })
        }
        isLoading = false
    }

    @MainActor func removeItem(at offsets: IndexSet) async {
        for i in offsets {
            let item = items[i]
            _ = try? await APIService.shared.delete("/watchlist/\(item.itemId)", token: app.token) as SimpleResponse
            app.setWatchlisted(item.itemId, on: false)
        }
        items.remove(atOffsets: offsets)
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
