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

    // MARK: - Offline snapshots

    /// The signature is what decides whether stored bytes may be shown at all,
    /// so it has to describe the view exactly and reproduce itself for the same
    /// view every time.
    func testTheSnapshotSignatureIgnoresTheOrderFiltersWereAddedIn() {
        let a = AnalyticsSnapshot.signature(
            dimension: "cast", filters: ["language": "en", "genre": "Drama"]
        )
        let b = AnalyticsSnapshot.signature(
            dimension: "cast", filters: ["genre": "Drama", "language": "en"]
        )
        XCTAssertEqual(a, b, "the same view signed differently depending on tap order")
    }

    func testDifferentViewsNeverShareASignature() {
        let overview = AnalyticsSnapshot.signature(dimension: "overview", filters: [:])
        let cast = AnalyticsSnapshot.signature(dimension: "cast", filters: [:])
        let castFiltered = AnalyticsSnapshot.signature(dimension: "cast", filters: ["language": "en"])
        let castOther = AnalyticsSnapshot.signature(dimension: "cast", filters: ["language": "ja"])
        XCTAssertEqual(Set([overview, cast, castFiltered, castOther]).count, 4)
    }

    func testStoredBytesComeBackOnlyForTheViewTheyWereCapturedUnder() {
        let store = JSONSnapshot(name: "tests-\(UUID().uuidString)")
        defer { store.clear() }

        let payload = Data(#"{"films":412}"#.utf8)
        store.save(payload, signature: "cast&language=en")

        XCTAssertEqual(store.load(signature: "cast&language=en"), payload)
        // A different lens must not be handed the last one's numbers.
        XCTAssertNil(store.load(signature: "cast&language=ja"))
        XCTAssertNil(store.load(signature: "overview"))
    }

    func testClearingASnapshotLeavesNothingToRestore() {
        let store = JSONSnapshot(name: "tests-\(UUID().uuidString)")
        store.save(Data("{}".utf8), signature: "overview")
        XCTAssertNotNil(store.load(signature: "overview"))

        store.clear()
        XCTAssertNil(store.load(signature: "overview"), "cleared bytes were still readable")
    }

    /// Logging out has to take the analytics snapshot with it. It is a record of
    /// what someone has watched, and the next person to sign in on this device
    /// must not be seeded from it.
    func testLoggingOutDiscardsTheAnalyticsSnapshot() {
        AnalyticsSnapshot.save(Data(#"{"films":412}"#.utf8), signature: "overview")
        XCTAssertNotNil(AnalyticsSnapshot.load(signature: "overview"))

        AppState(userDefaults: defaults).logout()

        XCTAssertNil(
            AnalyticsSnapshot.load(signature: "overview"),
            "one account's history was left on disk for the next"
        )
    }

    // MARK: - Retired services

    /// The catalogue of services shrank from thirty-one to fifteen. A selection
    /// naming one that is gone must not sit invisibly in the array — absent from
    /// the settings screen, still sent on every request.
    func testASelectionNamingARetiredServiceIsDroppedOnLaunch() {
        defaults.set(["netflix", "roku", "mubi", "kanopy"], forKey: "mk_platforms")

        let app = AppState(userDefaults: defaults)

        XCTAssertEqual(app.selectedPlatforms, ["netflix", "mubi"],
                       "retired keys survived a relaunch")
    }

    func testEveryShippedPlatformKeyIsOneTheAppStillKnows() {
        // Guards the two lists drifting apart: `knownPlatformKeys` is derived
        // from `allPlatforms`, so anything here that is not in it is a typo.
        for platform in allPlatforms {
            XCTAssertTrue(knownPlatformKeys.contains(platform.key),
                          "\(platform.key) is not in knownPlatformKeys")
        }
        XCTAssertEqual(allPlatforms.count, 15)
    }

    func testAServiceMonogramStaysLegibleOnItsOwnAccent() {
        // The ink is picked by luminance, so a dark tile must not also get dark
        // text. Checked across every service rather than the one that prompted
        // it, since the list changes.
        for platform in allPlatforms {
            XCTAssertTrue(
                platform.onAccentColor == .black || platform.onAccentColor == .white,
                "\(platform.name) resolved neither ink colour"
            )
        }
    }

    // MARK: - Decoding what the server sends

    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONDecoder().decode(type, from: Data(json.utf8))
    }

    /// Watchmode is optional at every level, and the sheet has to open whether
    /// or not any of it arrived.
    func testATitleDecodesWithNoWatchmodeBlockAtAll() throws {
        let details = try decode(TitleDetails.self, #"{"title":"Heat","runtime":170}"#)
        XCTAssertEqual(details.title, "Heat")
        XCTAssertNil(details.watchmode)
    }

    func testWatchmodeWithNothingToSayIsNotDrawn() throws {
        let extras = try decode(WatchmodeExtras.self, #"""
        {"pros":null,"cons":null,"verdict":null,"rent":null,"buy":null,
         "streamingOn":[],"certificate":null,"certificateRegion":"US"}
        """#)
        XCTAssertFalse(extras.hasContent, "an empty block would draw an empty section")
    }

    func testACertificateAloneIsWorthDrawingTheSectionFor() throws {
        let extras = try decode(WatchmodeExtras.self, #"""
        {"pros":null,"cons":null,"verdict":null,"rent":null,"buy":null,
         "streamingOn":[],"certificate":"15","certificateRegion":"GB"}
        """#)
        XCTAssertTrue(extras.hasContent)
        XCTAssertEqual(extras.certificate, "15")
    }

    func testAPriceReadsAsMoneyRatherThanAFloat() throws {
        let price = try decode(WatchmodePrice.self, #"{"price":3.9,"service":"Amazon"}"#)
        // 3.9 must not render as "$3.9".
        XCTAssertEqual(price.label, "$3.90")
        XCTAssertEqual(price.service, "Amazon")
    }

    /// The analytics payload grew several optional blocks. A history with none
    /// of them resolved still has to decode.
    func testAnalyticsDecodesWhenEveryOptionalBlockIsAbsent() throws {
        let response = try decode(AnalyticsResponse.self, #"""
        {"dimension":"overview","dimensions":[],
         "filters":{"applied":[],"available":{"languages":[],"genres":[],"decades":[],
                    "directors":[],"cast":[],"tags":[]}},
         "scope":{"films":0,"filmsTotal":0,"filtered":false},
         "coverage":{"films":0,"resolved":0,"pending":0,"unmatched":0,"needsResolution":[]},
         "summary":{"films":0,"viewings":0,"rated":0,"meanRating":null,"runtimeMinutes":0,
                    "tasteOffset":null,"comparedOn":0}}
        """#)
        XCTAssertNil(response.profile)
        XCTAssertNil(response.quadrant)
        // The facets added later are optional, so an older server still decodes.
        XCTAssertTrue(response.filters.available.options(for: "keyword").isEmpty)
        XCTAssertTrue(response.filters.available.options(for: "country").isEmpty)
    }

    func testTheNewFacetsAreReadWhenTheServerSendsThem() throws {
        let available = try decode(AvailableFilters.self, #"""
        {"languages":[],"genres":[],"decades":[],"directors":[],"cast":[],"tags":[],
         "keywords":[{"value":"heist","label":"heist","films":4}],
         "certifications":[{"value":"R","label":"R","films":9}]}
        """#)
        XCTAssertEqual(available.options(for: "keyword").first?.value, "heist")
        XCTAssertEqual(available.options(for: "certification").first?.films, 9)
        // An unknown key is empty rather than a crash.
        XCTAssertTrue(available.options(for: "nonsense").isEmpty)
    }
}
