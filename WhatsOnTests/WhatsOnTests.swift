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

    // MARK: - Letterboxd export reading

    /// A temporary directory shaped like an uncompressed Letterboxd export.
    private func makeExportFolder(files: [String: String]) throws -> URL {
        let dir = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("letterboxd-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        for (name, text) in files {
            try text.write(to: dir.appendingPathComponent(name), atomically: true, encoding: .utf8)
        }
        return dir
    }

    func testReadingAFolderPicksUpEveryCsvAndIgnoresTheRest() throws {
        let dir = try makeExportFolder(files: [
            "diary.csv": "Date,Name,Year\n2026-01-01,Heat,1995",
            "ratings.csv": "Date,Name,Year,Rating\n2026-01-01,Heat,1995,4.5",
            "watchlist.csv": "Date,Name,Year\n2026-01-01,Stalker,1979",
            "profile.txt": "not a csv",
        ])
        defer { try? FileManager.default.removeItem(at: dir) }

        let files = try LetterboxdExport.read(urls: [dir])

        XCTAssertEqual(files.count, 3)
        XCTAssertTrue(files.allSatisfy { $0.name.hasSuffix(".csv") })
        XCTAssertTrue(files.contains { $0.text.contains("Heat") })
    }

    func testLooseCsvFilesCanBePickedInstead() throws {
        let dir = try makeExportFolder(files: ["diary.csv": "Date,Name,Year\n2026-01-01,Heat,1995"])
        defer { try? FileManager.default.removeItem(at: dir) }

        let files = try LetterboxdExport.read(urls: [dir.appendingPathComponent("diary.csv")])

        XCTAssertEqual(files.count, 1)
        XCTAssertEqual(files.first?.name, "diary.csv")
    }

    func testAStillZippedExportSaysSoRatherThanFailingSilently() throws {
        let dir = try makeExportFolder(files: ["letterboxd.zip": "PK"])
        defer { try? FileManager.default.removeItem(at: dir) }

        XCTAssertThrowsError(try LetterboxdExport.read(urls: [dir.appendingPathComponent("letterboxd.zip")])) { error in
            // The message has to name the fix — "Uncompress" — because a zip is
            // exactly what Letterboxd hands you and this is the common case.
            XCTAssertTrue(
                (error as? LetterboxdExport.ReadError)?.errorDescription?.contains("Uncompress") == true,
                "expected the uncompress hint, got \(error)"
            )
        }
    }

    func testAFolderWithNoCsvsIsRejected() throws {
        let dir = try makeExportFolder(files: ["readme.txt": "nothing here"])
        defer { try? FileManager.default.removeItem(at: dir) }

        XCTAssertThrowsError(try LetterboxdExport.read(urls: [dir]))
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
