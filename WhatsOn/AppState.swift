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

/// One thing to tell the reader, shown as a banner over whatever they are
/// looking at.
///
/// Errors were being swallowed in more than a dozen places — a tap on Watched
/// that failed left the button looking untouched and said nothing, so the only
/// way to find out was to notice later that the film was not in the list. A
/// banner is the smallest thing that makes a failure visible without taking
/// over the screen or interrupting what someone is doing.
struct AppNotice: Identifiable, Equatable {
    enum Kind: Equatable { case failure, success, progress }

    let id = UUID()
    let kind: Kind
    let message: String
    /// Progress notices stay until something replaces or clears them; the rest
    /// dismiss themselves, because a message about a finished thing that has to
    /// be tapped away is an interruption.
    var autoDismissAfter: TimeInterval? { kind == .progress ? nil : (kind == .failure ? 6 : 3) }
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

    /// The banner currently on screen, if any. One at a time: a stack of them
    /// over a phone screen is worse than the silence it replaced.
    var notice: AppNotice?
    /// Cancels the pending auto-dismiss when a new notice replaces an old one,
    /// so the newcomer gets its full time rather than the remainder of its
    /// predecessor's.
    private var noticeDismissTask: Task<Void, Never>?

    /// Say something went wrong. The only way a failure should ever be handled
    /// silently is if the user caused it deliberately, like cancelling a picker.
    func report(failure message: String) { show(AppNotice(kind: .failure, message: message)) }
    func report(success message: String) { show(AppNotice(kind: .success, message: message)) }
    /// A long job that is still running. Stays put until it is replaced.
    func report(progress message: String) { show(AppNotice(kind: .progress, message: message)) }

    /// Turn whatever a call threw into something worth reading.
    ///
    /// `APIError` already carries the server's own message where there is one,
    /// which is nearly always more useful than a generic failure line.
    func report(error: Error, whileTrying action: String) {
        if let api = error as? APIError {
            if case .unauthorized = api { logout(); return }
            report(failure: "\(action) failed — \(api.errorDescription ?? "please try again").")
        } else {
            report(failure: "\(action) failed — \(error.localizedDescription)")
        }
    }

    // MARK: Letterboxd import

    /// Whether an import is in flight, and a counter that changes when one
    /// finishes.
    ///
    /// Both live here rather than on the screen that starts the import, and
    /// that is the whole point: the upload is a large body over a slow link,
    /// and someone who kicks it off and goes back to browsing used to lose
    /// every trace of it. The request itself always survived — it was started
    /// on an unstructured Task — but the progress line, the result and the
    /// error all belonged to a view that no longer existed, so a finished
    /// import looked identical to one that never happened.
    ///
    /// `diaryImportGeneration` is what an analytics screen watches: it changes
    /// once per completed import, so a screen that was open reloads, and one
    /// opened later reads fresh data anyway.
    private(set) var isImportingDiary = false
    private(set) var diaryImportGeneration = 0
    private var importTask: Task<Void, Never>?

    /// Start an import that outlives whatever screen asked for it.
    ///
    /// Refuses to start a second while one is running rather than queueing:
    /// the server replaces the whole diary on each import, so two in flight
    /// would race to decide the history.
    func importDiary(files: [LetterboxdExport.File]) {
        guard !isImportingDiary else {
            report(failure: "An import is already running. Let it finish first.")
            return
        }
        isImportingDiary = true
        report(progress: "Importing \(files.count) file\(files.count == 1 ? "" : "s")…")

        // Asked here, not at launch: this is the first moment the permission is
        // about to be worth something, so the prompt explains itself. The import
        // does not wait on the answer — a refusal only costs the system
        // notification, and the in-app banner still reports either way.
        Task { await LocalNotifier.requestPermissionIfNeeded() }

        importTask = Task { [weak self] in
            guard let self else { return }
            defer { self.isImportingDiary = false }

            // The extra runtime is what makes the notification possible at all.
            // Backgrounded without it, the app is suspended within seconds and
            // the upload simply stops — so there would be nothing to announce.
            await withBackgroundTime(named: "letterboxd-import") {
                do {
                    let payload = files.map { ["name": $0.name, "text": $0.text] }
                    let response: DiaryImportResponse = try await APIService.shared.post(
                        "/letterboxd/diary", body: ["files": payload], token: self.token, timeout: 120
                    )
                    let films = response.films ?? 0
                    let viewings = response.viewings ?? 0
                    self.diaryImportGeneration &+= 1
                    self.report(success: "Imported \(films) films across \(viewings) viewings.")
                    await LocalNotifier.postIfBackgrounded(
                        title: "Import finished",
                        body: "\(films) films across \(viewings) viewings are ready."
                    )
                } catch {
                    self.report(error: error, whileTrying: "Importing your diary")
                    await LocalNotifier.postIfBackgrounded(
                        title: "Import failed",
                        body: "Your Letterboxd import could not be saved. Open the app to try again."
                    )
                }
            }
        }
    }

    func dismissNotice() {
        noticeDismissTask?.cancel()
        noticeDismissTask = nil
        notice = nil
    }

    private func show(_ next: AppNotice) {
        noticeDismissTask?.cancel()
        notice = next
        guard let after = next.autoDismissAfter else { noticeDismissTask = nil; return }
        noticeDismissTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(after))
            guard !Task.isCancelled else { return }
            // Only clear the notice this task was started for; a newer one owns
            // the screen by the time a stale timer fires.
            if self?.notice?.id == next.id { self?.notice = nil }
        }
    }

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
        // Filtered against the current list rather than restored verbatim: the
        // catalogue of services has shrunk, and a selection naming one that is
        // gone would sit in the array invisibly — absent from the settings
        // screen, still sent on every request. The server ignores keys it does
        // not know, so this is about the app agreeing with what it shows.
        selectedPlatforms = (defaults.stringArray(forKey: platformsKey) ?? [])
            .filter { knownPlatformKeys.contains($0) }
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
