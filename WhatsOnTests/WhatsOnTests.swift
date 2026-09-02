//
//  WhatsOnTests.swift
//  WhatsOnTests
//
//  Created by Dion David on 4/7/26.
//

import XCTest
@testable import WhatsOn

@MainActor
final class WhatsOnTests: XCTestCase {
    private var defaults: UserDefaults!
    private let suiteName = "WhatsOnTests.ThemePrefs"

    override func setUpWithError() throws {
        defaults = UserDefaults(suiteName: suiteName)
        defaults.removePersistentDomain(forName: suiteName)
        ThemeManager.shared.applyTheme(AppTheme.defaultTheme)
    }

    override func tearDownWithError() throws {
        defaults.removePersistentDomain(forName: suiteName)
        ThemeManager.shared.applyTheme(AppTheme.defaultTheme)
        defaults = nil
    }

    func testThemeSelectionPersistsAndRestoresOnInit() throws {
        let app = AppState(userDefaults: defaults)
        XCTAssertEqual(app.selectedThemeId, AppTheme.defaultTheme.id)

        app.saveTheme(AppTheme.oceanTeal.id)
        XCTAssertEqual(defaults.string(forKey: "mk_theme_id"), AppTheme.oceanTeal.id)

        let restored = AppState(userDefaults: defaults)
        XCTAssertEqual(restored.selectedThemeId, AppTheme.oceanTeal.id)
        XCTAssertEqual(ThemeManager.shared.current.id, AppTheme.oceanTeal.id)
    }

    func testInvalidPersistedThemeFallsBackToDefaultTheme() throws {
        defaults.set("unknown_theme_id", forKey: "mk_theme_id")

        let app = AppState(userDefaults: defaults)
        XCTAssertEqual(app.selectedThemeId, AppTheme.defaultTheme.id)
        XCTAssertEqual(ThemeManager.shared.current.id, AppTheme.defaultTheme.id)
    }

    func testClientErrorDescriptionUsesServerMessage() {
        let error = APIError.clientError(400, "Validation failed")
        XCTAssertEqual(error.errorDescription, "Validation failed")
    }

    func testClientErrorDescriptionFallsBackToStatusCode() {
        let error = APIError.clientError(422, nil)
        XCTAssertEqual(error.errorDescription, "Request failed (422).")
    }

    // MARK: - Currently Watching

    func testAddingToCurrentlyWatchingRemovesTheShowFromTheWatchlist() throws {
        let app = AppState(userDefaults: defaults)
        app.setWatchlisted("tv-1399", on: true)
        XCTAssertTrue(app.watchlistIds.contains("tv-1399"))

        app.setCurrentlyWatching("tv-1399", on: true)

        // The server does the same thing; this mirrors it so the bookmark
        // control does not keep claiming the show is still saved for later.
        XCTAssertTrue(app.currentlyWatchingIds.contains("tv-1399"))
        XCTAssertFalse(app.watchlistIds.contains("tv-1399"))
    }

    func testRemovingFromCurrentlyWatchingLeavesTheWatchlistAlone() throws {
        let app = AppState(userDefaults: defaults)
        app.setWatchlisted("tv-42", on: true)
        app.setCurrentlyWatching("tv-1399", on: true)

        app.setCurrentlyWatching("tv-1399", on: false)

        XCTAssertFalse(app.currentlyWatchingIds.contains("tv-1399"))
        XCTAssertTrue(app.watchlistIds.contains("tv-42"))
    }

    func testCurrentlyWatchingSurvivesRelaunchAndIsClearedOnLogout() throws {
        let app = AppState(userDefaults: defaults)
        app.setCurrentlyWatching("tv-1399", on: true)

        let restored = AppState(userDefaults: defaults)
        XCTAssertEqual(restored.currentlyWatchingIds, ["tv-1399"])

        restored.logout()
        XCTAssertTrue(restored.currentlyWatchingIds.isEmpty)
        XCTAssertNil(defaults.stringArray(forKey: "mk_currently_watching_ids"))
    }

    func testMarkedCaughtUpClearsOnlyTheNewEpisodeFlag() {
        let item = CurrentlyWatchingItem(
            itemId: "tv-1399",
            title: "A Show",
            posterUrl: nil,
            state: "airing",
            scheduleMessage: "New episodes Thursdays",
            hasNewEpisode: true
        )

        let cleared = item.markedCaughtUp()

        XCTAssertEqual(cleared.hasNewEpisode, false)
        XCTAssertEqual(cleared.itemId, item.itemId)
        XCTAssertEqual(cleared.scheduleMessage, item.scheduleMessage)
        XCTAssertEqual(cleared.state, item.state)
    }
}
