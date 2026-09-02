//
//  ContentView.swift
//  WhatsOn
//
//  Created by Dion David on 4/7/26.
//

import SwiftUI
import PhotosUI
import Observation
import Security

@MainActor
enum KeychainStore {
    private static var service: String {
        Bundle.main.bundleIdentifier ?? "com.diondavid.whatson"
    }

    private static let account = "auth_token"

    private static var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
    }

    @discardableResult
    static func save(_ token: String) -> Bool {
        var query = baseQuery
        let data = Data(token.utf8)

        SecItemDelete(query as CFDictionary)
        query[kSecValueData as String] = data
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly

        return SecItemAdd(query as CFDictionary, nil) == errSecSuccess
    }

    static func read() -> String? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess,
              let data = result as? Data,
              let token = String(data: data, encoding: .utf8) else { return nil }
        return token
    }

    static func delete() {
        SecItemDelete(baseQuery as CFDictionary)
    }
}

@Observable
@MainActor
final class AppState {
    enum Page { case loading, auth, platforms, catalog }

    var page: Page = .loading
    var token: String = ""
    var username: String = ""
    var selectedPlatforms: [String] = []
    var selectedLanguages: [String] = []
    var watchedIds: Set<String> = []
    var watchlistIds: Set<String> = []
    var selectedThemeId: String = AppTheme.defaultTheme.id

    private let tokenKey      = "mk_token"
    private let usernameKey   = "mk_username"
    private let platformsKey  = "mk_platforms"
    private let languagesKey  = "mk_languages"
    private let watchedKey    = "mk_watched_ids"
    private let watchlistKey  = "mk_watchlist_ids"
    private let themeKey      = "mk_theme_id"
    private let defaults: UserDefaults

    init(userDefaults: UserDefaults = .standard) {
        defaults = userDefaults

        if KeychainStore.read() == nil,
           let legacyToken = defaults.string(forKey: tokenKey)?.trimmingCharacters(in: .whitespaces),
           !legacyToken.isEmpty {
            _ = KeychainStore.save(legacyToken)
            defaults.removeObject(forKey: tokenKey)
        }

        token = KeychainStore.read()?.trimmingCharacters(in: .whitespaces) ?? ""
        username = defaults.string(forKey: usernameKey) ?? ""
        selectedPlatforms = defaults.stringArray(forKey: platformsKey) ?? []
        selectedLanguages = defaults.stringArray(forKey: languagesKey) ?? []
        watchedIds = Set(defaults.stringArray(forKey: watchedKey) ?? [])
        watchlistIds = Set(defaults.stringArray(forKey: watchlistKey) ?? [])

        let theme = AppTheme.theme(with: defaults.string(forKey: themeKey) ?? AppTheme.defaultTheme.id)
        selectedThemeId = theme.id
        ThemeManager.shared.applyTheme(theme)
        page = token.isEmpty ? .auth : .catalog
    }

    func saveSession(token: String, username: String, isNewUser: Bool = false) {
        self.token = token.trimmingCharacters(in: .whitespaces)
        self.username = username
        _ = KeychainStore.save(self.token)
        defaults.removeObject(forKey: tokenKey)
        defaults.set(username, forKey: usernameKey)
        page = isNewUser ? .platforms : .catalog
    }

    func savePlatforms(_ platforms: [String]) {
        selectedPlatforms = platforms
        defaults.set(platforms, forKey: platformsKey)
    }

    func saveLanguages(_ languages: [String]) {
        selectedLanguages = languages
        defaults.set(languages, forKey: languagesKey)
    }

    func updateToken(_ newToken: String) {
        token = newToken.trimmingCharacters(in: .whitespaces)
        _ = KeychainStore.save(token)
        defaults.removeObject(forKey: tokenKey)
    }

    func updateUsername(_ newUsername: String) {
        username = newUsername
        defaults.set(username, forKey: usernameKey)
    }

    func setWatched(_ id: String, watched: Bool) {
        if watched { watchedIds.insert(id) } else { watchedIds.remove(id) }
        defaults.set(Array(watchedIds), forKey: watchedKey)
    }

    func replaceWatchedIds(_ ids: [String]) {
        watchedIds = Set(ids)
        defaults.set(ids, forKey: watchedKey)
    }

    func setWatchlisted(_ id: String, on: Bool) {
        if on { watchlistIds.insert(id) } else { watchlistIds.remove(id) }
        defaults.set(Array(watchlistIds), forKey: watchlistKey)
    }

    func replaceWatchlistIds(_ ids: [String]) {
        watchlistIds = Set(ids)
        defaults.set(ids, forKey: watchlistKey)
    }

    func saveTheme(_ id: String) {
        let theme = AppTheme.theme(with: id)
        selectedThemeId = theme.id
        defaults.set(theme.id, forKey: themeKey)
        ThemeManager.shared.applyTheme(theme)
    }

    func logout() {
        token = ""
        username = ""
        selectedPlatforms = []
        selectedLanguages = []
        watchedIds = []
        watchlistIds = []

        KeychainStore.delete()
        defaults.removeObject(forKey: tokenKey)
        defaults.removeObject(forKey: usernameKey)
        defaults.removeObject(forKey: platformsKey)
        defaults.removeObject(forKey: languagesKey)
        defaults.removeObject(forKey: watchedKey)
        defaults.removeObject(forKey: watchlistKey)
        page = .auth
    }
}

// MARK: - Root Router

struct ContentView: View {
    @State private var app = AppState()
    @Environment(ThemeManager.self) private var themeManager

    var body: some View {
        ZStack {
            themeManager.current.background.ignoresSafeArea()
            switch app.page {
            case .loading:   LoadingView()
            case .auth:      AuthView()
            case .platforms: PlatformsView()
            case .catalog:   CatalogView()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .environment(app)
    }
}

// MARK: - Loading

/// Reusable inline WhatsOn brand header (logo + name side by side)
struct WhatsOnTitle: View {
    var size: CGFloat = 28
    var logoSize: CGFloat = 32

    var body: some View {
        HStack(spacing: 10) {
            Image("WhatsOnLogo")
                .resizable()
                .scaledToFit()
                .frame(width: logoSize, height: logoSize)
                .clipShape(RoundedRectangle(cornerRadius: logoSize * 0.22, style: .continuous))
                .shadow(color: .mkAccent.opacity(0.4), radius: 6, x: 0, y: 3)
            Text(Brand.displayName)
                .font(.system(size: size, weight: .bold, design: .rounded))
                .foregroundStyle(LinearGradient(colors: [.mkAccent, .mkAccentAlt], startPoint: .leading, endPoint: .trailing))
        }
    }
}

struct LoadingView: View {
    var body: some View {
        VStack(spacing: 16) {
            WhatsOnTitle(size: 30, logoSize: 34)
            ProgressView().tint(.mkAccent).padding(.top, 8)
        }
    }
}

// MARK: - Auth

struct AuthView: View {
    @Environment(AppState.self) private var app

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
                    WhatsOnTitle(size: 34, logoSize: 40)
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
        .scrollBounceBehavior(.basedOnSize)
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
                            .foregroundColor(mode == m ? .mkOnAccent : .mkMuted)
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
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var selected: Set<String> = []
    @State private var selectedLangs: Set<String> = []
    @State private var isLoading = true
    @State private var isSaving  = false
    @State private var errorMsg: String?
    @State private var showLogoutAlert = false

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
                IconButton(icon: "rectangle.portrait.and.arrow.right") { showLogoutAlert = true }
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
                                Image("WhatsOnLogo")
                                    .resizable()
                                    .scaledToFit()
                                    .frame(width: 16, height: 16)
                                    .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
                                Text(Brand.displayName)
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
        .alert("Log Out", isPresented: $showLogoutAlert) {
            Button("Log Out", role: .destructive) { app.logout() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Are you sure you want to log out?")
        }
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
        } catch let err as APIError {
            isSaving = false
            if case .unauthorized = err {
                app.logout()
                return
            }
            // Stay on this screen so the message is visible and the user can
            // retry. Navigating away here left the catalog built from the old
            // server-side selection with nothing explaining the mismatch.
            errorMsg = "Couldn't save your services. Tap Save to try again."
            return
        } catch {
            isSaving = false
            errorMsg = "Couldn't save your services. Tap Save to try again."
            return
        }
        isSaving = false
        if app.page == .platforms {
            app.page = .catalog
        } else {
            dismiss()
        }
    }
}

/// A service's logo, or a tinted monogram when no artwork is bundled for it.
/// The backend supports more services than the app ships logos for; those are
/// still selectable rather than being hidden from the picker.
struct PlatformArtwork: View {
    let platform: StreamingPlatform
    var size: CGFloat = 46
    var cornerRadius: CGFloat = 10

    var body: some View {
        Group {
            if let asset = platform.logoAsset {
                Image(asset)
                    .resizable()
                    .scaledToFit()
            } else {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(platform.accentColor.opacity(0.28))
                    .overlay(
                        Text(platform.monogram)
                            .font(.system(size: size * 0.36, weight: .bold, design: .rounded))
                            .foregroundColor(.mkText)
                            .minimumScaleFactor(0.6)
                            .lineLimit(1)
                            .padding(2)
                    )
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
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
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(isSelected ? platform.accentColor.opacity(0.30) : Color.mkCard)
                        .overlay(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .stroke(
                                    isSelected ? platform.accentColor.opacity(0.8) : Color.mkBorder,
                                    lineWidth: isSelected ? 1.5 : 1
                                )
                        )
                        .frame(width: 62, height: 62)

                    PlatformArtwork(platform: platform, size: 46, cornerRadius: 10)

                    if isSelected {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 14))
                            .foregroundColor(.mkText)
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
    enum MainTab: String, CaseIterable, Identifiable {
        case discover
        case watched
        case watchlist

        var id: String { rawValue }
        var label: String {
            switch self {
            case .discover: return "Discover"
            case .watched: return "Watched"
            case .watchlist: return "Watchlist"
            }
        }
        var systemImage: String {
            switch self {
            case .discover: return "safari"
            case .watched: return "checkmark.circle"
            case .watchlist: return "bookmark"
            }
        }
        var title: String {
            switch self {
            case .discover: return "Streaming Catalog"
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
            } else if isLoading || (movies.isEmpty && meta?.refreshing == true) {
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
                    .font(.system(size: 11, weight: .semibold)).tracking(0.5)
                    .foregroundColor(.mkAccent)
                Text(mainTab.title)
                    .font(.system(size: 20, weight: .bold)).foregroundColor(.mkText)
            }
            Spacer()
            if mainTab == .discover {
                IconButton(icon: "arrow.clockwise", spinning: isLoading) { Task { await fetch() } }
            }
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
                                .font(.system(size: 17, weight: .medium))
                            if isSelected {
                                Text(tab.label)
                                    .font(.system(size: 14, weight: .semibold))
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
                        Image(systemName: "play.rectangle.on.rectangle").font(.system(size: 10))
                        Text("\(app.selectedPlatforms.count) services").font(.system(size: 12, weight: .medium))
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
        if watchlistOnly || streamingWatchlistOnly {
            params["watchlistOnly"] = "true"
            if streamingWatchlistOnly { params["streamingOnly"] = "true" }
        }
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
    @Environment(AppState.self) private var app
    @State private var isTogglingWatched = false
    @State private var isTogglingWatchlist = false
    /// Dominant color extracted from the poster; nil until the async fetch completes.
    /// It no longer tints the whole card — see `edgeTint`.
    @State private var dominantColor: Color? = nil
    var isTV: Bool { movie.mediaType == "tv" }
    var isWatched: Bool { app.watchedIds.contains(movie.id) }
    var isWatchlisted: Bool { app.watchlistIds.contains(movie.id) }
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
            Image(systemName: "film").font(.system(size: 22)).foregroundColor(.mkMuted.opacity(0.4))
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
                                .font(.system(size: 11, weight: .semibold))
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
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(.mkText)
                    .lineLimit(2)
                    .frame(maxWidth: .infinity, alignment: .leading)
                // Watchlist and watched sit together. The bookmark used to hide in
                // the poster's corner, where it read as decoration.
                HStack(spacing: 6) {
                    watchlistToggleButton
                    watchedToggleButton
                }
            }

            metaLine
                .padding(.top, 5)

            if let ov = movie.overview, !ov.isEmpty {
                Text(ov)
                    .font(.system(size: 12.5))
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
                .font(.system(size: 11, weight: .bold))
                .kerning(0.4)
                .foregroundColor(movie.kind.accent)
            if let y = movie.year {
                MetaDot()
                Text(String(y))
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(.mkMuted)
            }
            if let genres = movie.genres, !genres.isEmpty {
                MetaDot()
                Text(genres.prefix(2).joined(separator: " · "))
                    .font(.system(size: 11, weight: .semibold))
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
                        .font(.system(size: 21))
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

    var watchlistToggleButton: some View {
        Button { Task { await toggleWatchlist() } } label: {
            Group {
                if isTogglingWatchlist {
                    ProgressView().scaleEffect(0.6).tint(.mkAccent)
                        .frame(width: 22, height: 22)
                } else {
                    Image(systemName: isWatchlisted ? "bookmark.fill" : "bookmark")
                        .font(.system(size: 19))
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

// MARK: - Reusable Components

struct FilterChip: View {
    let label: String
    let icon: String
    let active: Bool
    /// Menus get a chevron; toggles do not — the old chip drew one either way,
    /// promising a picker that never opened.
    var showsChevron: Bool = true

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: icon).font(.system(size: 11, weight: .semibold))
            Text(label).font(.system(size: 13, weight: active ? .semibold : .medium))
            if showsChevron {
                Image(systemName: "chevron.down").font(.system(size: 9, weight: .bold))
            }
        }
        .foregroundColor(active ? .mkOnAccent : Color.mkText.opacity(0.78))
        .padding(.horizontal, 13).padding(.vertical, 8)
        .background(active ? Color.mkAccent : Color.clear, in: Capsule())
        .contentShape(Capsule())
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
/// A service's logo alone, sized to sit on a poster. Falls back to the monogram
/// for the services with no bundled artwork.
struct ProviderMark: View {
    let name: String
    var size: CGFloat = 13

    var platform: StreamingPlatform? {
        let lowered = name.lowercased()
        // Exact name first: with 31 services in the list, a substring match can
        // land on the wrong one (TMDB returns variants like "Netflix with Ads").
        return allPlatforms.first { $0.name.lowercased() == lowered }
            ?? allPlatforms.first { lowered.contains($0.key) }
    }

    var body: some View {
        Group {
            if let p = platform, let asset = p.logoAsset {
                Image(asset).resizable().scaledToFit()
            } else if let p = platform {
                RoundedRectangle(cornerRadius: 3, style: .continuous)
                    .fill(p.accentColor.opacity(0.9))
                    .overlay(
                        Text(p.monogram)
                            .font(.system(size: size * 0.5, weight: .bold, design: .rounded))
                            .foregroundColor(p.onAccentColor)
                            .minimumScaleFactor(0.5)
                            .lineLimit(1)
                    )
            } else {
                RoundedRectangle(cornerRadius: 3, style: .continuous)
                    .fill(Color.mkPlaceholderFill)
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: 3, style: .continuous))
        .accessibilityLabel(name)
    }
}

/// Wraps children onto as many lines as they need, at a fixed spacing.
///
/// Genre and service chips are variable-width and unbounded in count; an HStack
/// pushed them off the edge and a horizontal ScrollView hid them behind a swipe
/// nobody makes on a detail screen.
struct FlowRow: Layout {
    var spacing: CGFloat = 6

    /// Size a child against the width actually available, never against infinity.
    ///
    /// Asking with `.unspecified` let a long service or genre name report its full
    /// single-line width. One such chip was then wider than the row, and this
    /// layout reported that width as its own — pushing its container past the
    /// screen edge. `sizeThatFits` and `placeSubviews` have to measure children
    /// identically or placement drifts from the reported size, so both go through
    /// here.
    private func childSize(_ subview: LayoutSubview, available: CGFloat) -> CGSize {
        let proposal = available.isFinite
            ? ProposedViewSize(width: available, height: nil)
            : ProposedViewSize.unspecified
        var size = subview.sizeThatFits(proposal)
        size.width = min(size.width, available)
        return size
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var rowWidth: CGFloat = 0
        var rowHeight: CGFloat = 0
        var totalHeight: CGFloat = 0
        var widestRow: CGFloat = 0

        for subview in subviews {
            let size = childSize(subview, available: maxWidth)
            if rowWidth > 0 && rowWidth + spacing + size.width > maxWidth {
                widestRow = max(widestRow, rowWidth)
                totalHeight += rowHeight + spacing
                rowWidth = size.width
                rowHeight = size.height
            } else {
                rowWidth += rowWidth > 0 ? spacing + size.width : size.width
                rowHeight = max(rowHeight, size.height)
            }
        }
        totalHeight += rowHeight
        widestRow = max(widestRow, rowWidth)

        // Report the proposed width when there is one, so the layout fills its
        // column; otherwise the widest row, which by construction is the least
        // width that holds the content.
        return CGSize(width: maxWidth.isFinite ? maxWidth : widestRow, height: totalHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var rowHeight: CGFloat = 0

        for subview in subviews {
            let size = childSize(subview, available: bounds.width)
            if x > bounds.minX && x + size.width > bounds.maxX {
                x = bounds.minX
                y += rowHeight + spacing
                rowHeight = 0
            }
            subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}

/// Separator between items on a meta line.
struct MetaDot: View {
    var body: some View {
        Circle()
            .fill(Color.mkMuted.opacity(0.5))
            .frame(width: 3, height: 3)
    }
}

/// Every score on one shared surface, divided rather than boxed.
///
/// Replaces a row of individually-bordered chips, each with its own outline, that
/// read as four unrelated badges. One surface with rules between the scores makes
/// them comparable at a glance.
///
/// Cells size to their own content and the row scrolls horizontally. Splitting the
/// card's width into equal slots left roughly 30pt per score, so "100%" and "8.4"
/// were scaled down and then truncated mid-number once a title had all four.
struct ScoreStrip: View {
    let entries: [MovieCardView.RatingEntry]
    var compact: Bool = true

    @ViewBuilder
    var body: some View {
        if entries.isEmpty {
            EmptyView()
        } else {
            ScrollView(.horizontal) {
                HStack(spacing: 0) {
                    ForEach(entries.indices, id: \.self) { index in
                        scoreCell(entries[index])
                            .overlay(alignment: .leading) { rule(index > 0) }
                    }
                    // Ratings arrive from OMDB after the catalog does. Say so rather
                    // than leaving a lone TMDb score looking like the whole answer.
                    if entries.count == 1 && entries[0].label == "TMDb" {
                        Text("Scoring…")
                            .font(.system(size: 10.5, weight: .semibold))
                            .foregroundColor(.mkMuted)
                            .padding(.horizontal, 9)
                            .padding(.vertical, compact ? 6 : 12)
                            .overlay(alignment: .leading) { rule(true) }
                    }
                }
            }
            .scrollIndicators(.hidden)
            // Nothing to scroll when every score already fits, so don't rubber-band.
            .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.mkSubtleFill)
            .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .stroke(Color.mkHairline, lineWidth: 1)
            )
        }
    }

    /// Drawn as an overlay on the cell's leading edge rather than as a sibling in
    /// the stack: a bare `Rectangle` between content-sized cells has no ideal
    /// height to adopt inside a scroll view, and collapses to 10pt.
    @ViewBuilder
    func rule(_ visible: Bool) -> some View {
        if visible {
            Rectangle().fill(Color.mkHairline).frame(width: 1)
        }
    }

    @ViewBuilder
    func scoreCell(_ entry: MovieCardView.RatingEntry) -> some View {
        if compact {
            HStack(spacing: 5) {
                scoreMark(entry)
                Text(entry.value)
                    .font(.system(size: 12.5, weight: .bold))
                    .foregroundColor(.mkText)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .padding(.horizontal, 11)
            .padding(.vertical, 6)
            .fixedSize(horizontal: true, vertical: false)
        } else {
            VStack(spacing: 6) {
                scoreMark(entry, size: 18)
                Text(entry.value)
                    .font(.system(size: 17, weight: .bold))
                    .foregroundColor(.mkText)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                Text(entry.label.uppercased())
                    .font(.system(size: 9.5, weight: .semibold))
                    .kerning(0.6)
                    .foregroundColor(.mkMuted)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .frame(minWidth: 74)
            .fixedSize(horizontal: true, vertical: false)
        }
    }

    @ViewBuilder
    func scoreMark(_ entry: MovieCardView.RatingEntry, size: CGFloat = 13) -> some View {
        if let asset = entry.logoAsset {
            Image(asset).resizable().scaledToFit()
                .frame(width: size, height: size)
                .clipShape(RoundedRectangle(cornerRadius: 3, style: .continuous))
        } else {
            Circle().fill(entry.color).frame(width: size * 0.55, height: size * 0.55)
        }
    }
}

// MARK: - Genre Picker Sheet

struct GenrePickerSheet: View {
    @Binding var selected: Set<String>
    @Environment(\.dismiss) private var dismiss
    let onApply: () -> Void

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 10), count: 3)
    private let genreAccent = Color(red: 0.56, green: 0.38, blue: 1.0)

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

                        GlassEffectContainer {
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
                                            .foregroundColor(isOn ? .mkText : .mkMuted)
                                            .glassEffect(
                                                isOn
                                                    ? .regular.tint(genreAccent)
                                                    : .regular,
                                                in: RoundedRectangle(cornerRadius: 12, style: .continuous)
                                            )
                                    }
                                    .buttonStyle(ScaleButtonStyle())
                                }
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

    // Always show all supported languages so any language can be used as a filter,
    // regardless of which languages the user configured in their profile.
    var displayLanguages: [AppLanguage] { allLanguages }

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

                        GlassEffectContainer {
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
                                            .foregroundColor(isOn ? .mkText : .mkMuted)
                                            .glassEffect(
                                                isOn
                                                    ? .regular.tint(.mkAccent)
                                                    : .regular,
                                                in: RoundedRectangle(cornerRadius: 12, style: .continuous)
                                            )
                                    }
                                    .buttonStyle(ScaleButtonStyle())
                                }
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
    var isDisabled: Bool = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if isLoading { ProgressView().tint(.mkOnAccent).scaleEffect(0.85) }
                else { Image(systemName: icon).font(.system(size: 15)) }
                Text(label)
                    .font(.system(size: 16, weight: .semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)
            }
            .padding(.vertical, 15)
        }
        .disabled(isLoading || isDisabled)
        .tint(.mkAccent)
        .buttonStyle(.glassProminent)
        .frame(maxWidth: .infinity)
    }
}

struct IconButton: View {
    let icon: String
    var spinning: Bool = false
    let action: () -> Void
    @State private var angle: Double = 0
    var body: some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 17))
                .foregroundColor(.mkMuted)
                .rotationEffect(.degrees(angle))
                .frame(width: 36, height: 36)
                .glassEffect(.regular, in: Circle())
                .contentShape(Circle())
        }
        .buttonStyle(ScaleButtonStyle())
        .onAppear {
            if spinning {
                withAnimation(.linear(duration: 1).repeatForever(autoreverses: false)) {
                    angle = 360
                }
            }
        }
        .onChange(of: spinning) { _, nowSpinning in
            if nowSpinning {
                angle = 0
                withAnimation(.linear(duration: 1).repeatForever(autoreverses: false)) {
                    angle = 360
                }
            } else {
                withAnimation(.default) { angle = 0 }
            }
        }
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

    private let minYear: Double = 1950
    private let maxYear: Double = Double(Calendar.current.component(.year, from: Date()))

    @State private var sliderMin: Double = 1950
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
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var details: TitleDetails?
    @State private var isLoadingExtras = true
    @State private var detailsError: String? = nil
    @State private var isTogglingWatched = false
    @State private var isTogglingWatchlist = false
    /// Drives the hero wash. One title on screen, so a full-strength tint reads
    /// as this film's colour rather than as noise.
    @State private var dominantColor: Color? = nil

    var isWatched: Bool { app.watchedIds.contains(movie.id) }
    var isWatchlisted: Bool { app.watchlistIds.contains(movie.id) }
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
                                        .font(.system(size: 13.5))
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
                            .font(.system(size: 13, weight: .bold))
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
                        .font(.system(size: 24, weight: .bold))
                        .foregroundColor(.mkText)
                        .lineLimit(3)
                        .fixedSize(horizontal: false, vertical: true)
                    if let t = details?.tagline, !t.isEmpty {
                        Text("“\(t)”")
                            .font(.system(size: 12.5))
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
                    Image(systemName: "film").font(.system(size: 26)).foregroundColor(.mkMuted.opacity(0.4))
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
                .font(.system(size: 11, weight: .bold))
                .kerning(0.4)
                .foregroundColor(movie.kind.accent)
            if let y = movie.year {
                MetaDot()
                Text(String(y))
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(.mkMuted)
            }
            if let runtime = details?.runtime, runtime > 0 {
                MetaDot()
                Text("\(runtime / 60)h \(runtime % 60)m")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(.mkMuted)
            } else if let seasons = details?.numberOfSeasons, seasons > 0 {
                MetaDot()
                Text("\(seasons) season\(seasons == 1 ? "" : "s")")
                    .font(.system(size: 11, weight: .semibold))
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
                .font(.system(size: 11, weight: .bold))
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
                        .font(.system(size: 13.5, weight: .semibold))
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
                Button { Task { await toggleWatchlist() } } label: {
                    HStack(spacing: 8) {
                        if isTogglingWatchlist {
                            ProgressView().scaleEffect(0.7).tint(.mkText)
                        } else {
                            Image(systemName: isWatchlisted ? "bookmark.fill" : "bookmark")
                                .font(.system(size: 16, weight: .semibold))
                                .contentTransition(.symbolEffect(.replace))
                        }
                        Text(isWatchlisted ? "On Watchlist" : "Watchlist")
                            .font(.system(size: 14.5, weight: .semibold))
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
                                .font(.system(size: 16, weight: .semibold))
                                .contentTransition(.symbolEffect(.replace))
                        }
                        Text(isWatched ? "Watched" : "Mark Watched")
                            .font(.system(size: 14.5, weight: .semibold))
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

    // Reusable labeled section block
    @ViewBuilder
    func detailRow<Content: View>(icon: String, label: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(label, systemImage: icon)
                .font(.system(size: 13, weight: .semibold)).foregroundColor(.mkAccent)
            content()
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
    enum Tab: String { case services, appearance, profile, watched, watchlistTab }
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var tab: Tab = .services
    @Namespace private var tabGlass

    var body: some View {
        NavigationStack {
            ZStack {
                Color.mkBackground.ignoresSafeArea()
                VStack(spacing: 0) {
                    tabPicker.padding(.horizontal, 16).padding(.vertical, 10)
                    Divider().overlay(Color.mkBorder)
                    Group {
                        switch tab {
                        case .services:    ServicesTabView().environment(app)
                        case .appearance:  AppearanceTabView().environment(app)
                        case .profile:     ProfileTabView().environment(app)
                        case .watched:     WatchedOnlyTabView().environment(app)
                        case .watchlistTab: WatchlistOnlyTabView().environment(app)
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
        GlassEffectContainer {
            HStack(spacing: 4) {
                ForEach([(Tab.services, "play.rectangle.on.rectangle", "Services"),
                         (Tab.appearance, "paintpalette", "Color"),
                         (Tab.profile, "person.crop.circle", "Profile"),
                         (Tab.watched, "checkmark.circle", "Watched"),
                         (Tab.watchlistTab, "bookmark.circle", "Watchlist")], id: \.0.rawValue) { t, icon, label in
                    let isSelected = tab == t
                    Button {
                        withAnimation(.easeInOut(duration: 0.2)) { tab = t }
                    } label: {
                        VStack(spacing: 4) {
                            Image(systemName: icon).font(.system(size: 16))
                            Text(label).font(.system(size: 12, weight: .semibold))
                        }
                        .foregroundColor(isSelected ? .mkText : .mkMuted)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .glassEffect(
                        isSelected ? .regular.tint(.mkAccent).interactive() : .clear,
                        in: RoundedRectangle(cornerRadius: 12, style: .continuous)
                    )
                    .glassEffectID(t.rawValue, in: tabGlass)
                }
            }
        }
        .padding(4)
        .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

// MARK: Appearance Tab

struct AppearanceTabView: View {
    @Environment(AppState.self) private var app

    private let columns = [
        GridItem(.flexible(), spacing: 12),
        GridItem(.flexible(), spacing: 12)
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text("Color").font(.title3).bold().foregroundColor(.mkText).padding(.top, 4)
                Text("Choose a color theme for WhatsOn.")
                    .font(.subheadline)
                    .foregroundColor(.mkMuted)

                LazyVGrid(columns: columns, spacing: 12) {
                    ForEach(AppTheme.all) { theme in
                        Button {
                            app.saveTheme(theme.id)
                        } label: {
                            VStack(alignment: .leading, spacing: 10) {
                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    .fill(
                                        LinearGradient(
                                            colors: [theme.accent, theme.accentAlt],
                                            startPoint: .topLeading,
                                            endPoint: .bottomTrailing
                                        )
                                    )
                                    .frame(height: 56)
                                    .overlay(alignment: .topTrailing) {
                                        if app.selectedThemeId == theme.id {
                                            Image(systemName: "checkmark.circle.fill")
                                                .font(.system(size: 18))
                                                .foregroundColor(theme.onAccent)
                                                .padding(8)
                                        }
                                    }

                                HStack(spacing: 8) {
                                    // Ringed, because a light theme's background
                                    // dot is invisible on a light surface.
                                    Circle()
                                        .fill(theme.background)
                                        .overlay(Circle().stroke(Color.mkHairline, lineWidth: 1))
                                        .frame(width: 10, height: 10)
                                    Text(theme.name)
                                        .font(.system(size: 13, weight: .semibold))
                                        .foregroundColor(app.selectedThemeId == theme.id ? .mkAccent : .mkText)
                                        .lineLimit(2)
                                }
                            }
                            .padding(10)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color.mkSurface)
                            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: 14, style: .continuous)
                                    .stroke(app.selectedThemeId == theme.id ? Color.mkAccent.opacity(0.6) : Color.mkBorder, lineWidth: 1)
                            )
                        }
                        .buttonStyle(ScaleButtonStyle())
                    }
                }
                .padding(.bottom, 24)
            }
            .padding(.horizontal, 16)
            .padding(.top, 12)
        }
    }
}

// MARK: Services Tab

struct ServicesTabView: View {
    @Environment(AppState.self) private var app
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
                PlatformArtwork(platform: platform, size: 44, cornerRadius: 10)
                    .overlay(RoundedRectangle(cornerRadius: 10)
                        .stroke(isSelected ? Color.mkAccent.opacity(0.9) : Color.clear, lineWidth: 2))
                Text(platform.name).font(.system(size: 11, weight: .semibold))
                    .foregroundColor(isSelected ? .mkText : .mkMuted)
                    .lineLimit(1).minimumScaleFactor(0.7)
                    .frame(maxWidth: .infinity)
            }
            .padding(10)
            .frame(maxWidth: .infinity, minHeight: 80)
            .background(
                isSelected ? Color.mkAccent.opacity(0.22) : Color.mkCard,
                in: RoundedRectangle(cornerRadius: 14, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(isSelected ? Color.mkAccent.opacity(0.85) : Color.mkBorder,
                            lineWidth: isSelected ? 1.5 : 1)
            )
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
                .foregroundColor(isSelected ? .mkText : .mkMuted)
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(
                    isSelected ? Color.mkAccent.opacity(0.22) : Color.mkCard,
                    in: RoundedRectangle(cornerRadius: 12, style: .continuous)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(isSelected ? Color.mkAccent.opacity(0.85) : Color.mkBorder,
                                lineWidth: isSelected ? 1.5 : 1)
                )
        }
        .buttonStyle(ScaleButtonStyle())
    }
}

// MARK: Profile Tab

struct ProfileTabView: View {
    @Environment(AppState.self) private var app
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
                        MKButton(label: "Import Watched", icon: "eye.fill",
                                 isLoading: lbxImportProgress != nil && lbxIntendedType == "watched",
                                 isDisabled: lbxImportProgress != nil) {
                            lbxIntendedType = "watched"
                            showFileImporter = true
                        }
                        MKButton(label: "Import Watchlist", icon: "bookmark.fill",
                                 isLoading: lbxImportProgress != nil && lbxIntendedType == "watchlist",
                                 isDisabled: lbxImportProgress != nil) {
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
        .onChange(of: avatarItem) { _, item in
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
        // Matches MAX_IMPORT_BATCH on the server.
        let batchSize = 100
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
                // A watchlist upload supersedes the saved list, so the first
                // batch clears it and the rest append. A watched upload is a
                // history and only ever merges, so it never sets this.
                var body: [String: Any] = ["items": encodableChunk, "importType": lbxImportType]
                if lbxImportType == "watchlist" && offset == 0 {
                    body["replaceExisting"] = true
                }
                let resp: LetterboxdImportResponse = try await APIService.shared.post(
                    "/import/letterboxd",
                    body: body,
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
    @Environment(AppState.self) private var app
    @State private var items: [WatchedItem] = []
    @State private var isLoading = true
    @State private var isClearing = false
    @State private var confirmClear = false

    var body: some View {
        VStack(spacing: 0) {
            if !items.isEmpty {
                ClearListBar(
                    count: items.count,
                    label: "watched",
                    isClearing: isClearing,
                    action: { confirmClear = true }
                )
            }
            content
        }
        .confirmationDialog(
            "Clear your watched list?",
            isPresented: $confirmClear,
            titleVisibility: .visible
        ) {
            Button("Remove all \(items.count) titles", role: .destructive) {
                Task { await clearAll() }
            }
            Button("Cancel", role: .cancel) { }
        } message: {
            Text("This cannot be undone.")
        }
    }

    var content: some View {
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

    @MainActor func clearAll() async {
        isClearing = true
        // Optimistic: the list empties immediately and is reloaded from the
        // server if the call fails, so a slow network never looks like a no-op.
        let previous = items
        items = []
        do {
            let _: ToggleWatchedResponse = try await APIService.shared.delete("/watched", token: app.token)
            app.replaceWatchedIds([])
        } catch let err as APIError {
            items = previous
            if case .unauthorized = err { app.logout() }
        } catch {
            items = previous
        }
        isClearing = false
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

/// Header bar above a saved list, carrying the count and a destructive clear.
/// Solid, not glass: it sits in the content column, not the floating layer.
struct ClearListBar: View {
    let count: Int
    let label: String
    let isClearing: Bool
    let action: () -> Void

    var body: some View {
        HStack {
            Text("\(count) \(count == 1 ? "title" : "titles")")
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(.mkMuted)
            Spacer()
            Button(action: action) {
                HStack(spacing: 6) {
                    if isClearing {
                        ProgressView().scaleEffect(0.7).tint(.red)
                    } else {
                        Image(systemName: "trash").font(.system(size: 12, weight: .semibold))
                    }
                    Text(isClearing ? "Clearing…" : "Clear all")
                        .font(.system(size: 13, weight: .semibold))
                }
                .foregroundColor(.red)
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(Color.red.opacity(0.12), in: Capsule())
                .overlay(Capsule().stroke(Color.red.opacity(0.3), lineWidth: 1))
            }
            .buttonStyle(.plain)
            .disabled(isClearing)
            .accessibilityLabel("Clear entire \(label)")
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }
}

// MARK: Watchlist Tab

struct WatchlistOnlyTabView: View {
    @Environment(AppState.self) private var app
    @State private var items: [WatchlistItem] = []
    @State private var isLoading = true
    @State private var isClearing = false
    @State private var confirmClear = false

    var body: some View {
        VStack(spacing: 0) {
            if !items.isEmpty {
                ClearListBar(
                    count: items.count,
                    label: "watchlist",
                    isClearing: isClearing,
                    action: { confirmClear = true }
                )
            }
            content
        }
        .confirmationDialog(
            "Clear your watchlist?",
            isPresented: $confirmClear,
            titleVisibility: .visible
        ) {
            Button("Remove all \(items.count) titles", role: .destructive) {
                Task { await clearAll() }
            }
            Button("Cancel", role: .cancel) { }
        } message: {
            Text("This cannot be undone.")
        }
    }

    var content: some View {
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

    @MainActor func clearAll() async {
        isClearing = true
        let previous = items
        items = []
        do {
            let _: ToggleWatchedResponse = try await APIService.shared.delete("/watchlist", token: app.token)
            app.replaceWatchlistIds([])
        } catch let err as APIError {
            items = previous
            if case .unauthorized = err { app.logout() }
        } catch {
            items = previous
        }
        isClearing = false
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
        .environment(ThemeManager.shared)
}

// MARK: - View Helpers

extension View {
    @ViewBuilder
    func disableAutocap() -> some View {
        #if os(iOS)
        self.textInputAutocapitalization(.never)
        #else
        self
        #endif
    }

    func glassSurface(radius: CGFloat = 18, interactive: Bool = false) -> some View {
        modifier(GlassSurface(radius: radius, interactive: interactive))
    }
}

struct GlassSurface: ViewModifier {
    let radius: CGFloat
    let interactive: Bool

    @ViewBuilder
    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        if interactive {
            content.glassEffect(.regular.interactive(), in: shape)
        } else {
            content.glassEffect(.regular, in: shape)
        }
    }
}
