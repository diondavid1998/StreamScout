//
//  AppState.swift
//  WhatsOn
//
// The app's own state: the token in the keychain, and the lists and preferences
// kept on the device. No view lives here.
//

import SwiftUI
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
    /// Series in progress. Series only, and exclusive with the other two: the
    /// server moves a show out of the watchlist when it lands here.
    var currentlyWatchingIds: Set<String> = []
    var selectedThemeId: String = AppTheme.defaultTheme.id

    private let tokenKey      = "mk_token"
    private let usernameKey   = "mk_username"
    private let platformsKey  = "mk_platforms"
    private let languagesKey  = "mk_languages"
    private let watchedKey    = "mk_watched_ids"
    private let watchlistKey  = "mk_watchlist_ids"
    private let currentKey    = "mk_currently_watching_ids"
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
        currentlyWatchingIds = Set(defaults.stringArray(forKey: currentKey) ?? [])

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

    func setCurrentlyWatching(_ id: String, on: Bool) {
        if on {
            currentlyWatchingIds.insert(id)
            // Mirrors what the server just did, so the bookmark control does not
            // keep claiming the show is still saved for later.
            setWatchlisted(id, on: false)
        } else {
            currentlyWatchingIds.remove(id)
        }
        defaults.set(Array(currentlyWatchingIds), forKey: currentKey)
    }

    func replaceCurrentlyWatchingIds(_ ids: [String]) {
        currentlyWatchingIds = Set(ids)
        defaults.set(ids, forKey: currentKey)
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
        currentlyWatchingIds = []

        KeychainStore.delete()
        defaults.removeObject(forKey: tokenKey)
        defaults.removeObject(forKey: usernameKey)
        defaults.removeObject(forKey: platformsKey)
        defaults.removeObject(forKey: languagesKey)
        defaults.removeObject(forKey: watchedKey)
        defaults.removeObject(forKey: watchlistKey)
        defaults.removeObject(forKey: currentKey)
        // The cached feed and analytics are the previous account's; never seed a
        // new session from either. The analytics one matters more: it is a
        // record of what someone has watched.
        FeedSnapshot.clear()
        AnalyticsSnapshot.clear()
        page = .auth
    }
}
