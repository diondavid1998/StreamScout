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

    /// The rows an import could not resolve, as the summary lists them.
    ///
    /// "4 not found" gives the reader no way to find the gap in a list of three
    /// hundred, so the server now names them. The year is what separates two
    /// films sharing a title, and it is genuinely absent for anything the
    /// export has no release date for — so the label has to read both ways.
    func testAnUnresolvedRowIsLabelledWithItsYearWhenThereIsOne() throws {
        let titles = try decode([LetterboxdUnresolvedTitle].self, #"""
        [{"name":"Rashomon","year":1950},{"name":"Untitled Sequel","year":null}]
        """#)

        XCTAssertEqual(titles.map(\.label), ["Rashomon (1950)", "Untitled Sequel"])
    }

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
            ["dimension": "cast", "language": "en", "genre": "Drama"]
        )
        let b = AnalyticsSnapshot.signature(
            ["genre": "Drama", "dimension": "cast", "language": "en"]
        )
        XCTAssertEqual(a, b, "the same view signed differently depending on tap order")
    }

    func testDifferentViewsNeverShareASignature() {
        let overview = AnalyticsSnapshot.signature(["dimension": "overview"])
        let cast = AnalyticsSnapshot.signature(["dimension": "cast"])
        let castFiltered = AnalyticsSnapshot.signature(["dimension": "cast", "language": "en"])
        let castOther = AnalyticsSnapshot.signature(["dimension": "cast", "language": "ja"])
        XCTAssertEqual(Set([overview, cast, castFiltered, castOther]).count, 4)
    }

    /// The ordering changes what comes back, so it has to change the signature.
    /// Without this, switching from "most watched" to "highest rated" would seed
    /// the new view from the old view's stored bytes and show the reader a list
    /// they did not ask for until the response landed.
    func testTheOrderingIsPartOfTheSignature() {
        let byCount = AnalyticsSnapshot.signature(["dimension": "directors", "sort": "films"])
        let byRating = AnalyticsSnapshot.signature(["dimension": "directors", "sort": "rating"])
        let byRatingFloored = AnalyticsSnapshot.signature(
            ["dimension": "directors", "sort": "rating", "minFilms": "5"]
        )
        XCTAssertEqual(Set([byCount, byRating, byRatingFloored]).count, 3)
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
        // Keys must be unique, which is the drift the count above was really
        // standing in for: `knownPlatformKeys` is a Set, so a duplicate key
        // would shrink it silently and let one tile shadow another.
        XCTAssertEqual(knownPlatformKeys.count, allPlatforms.count,
                       "two services share a key")
        // Fifteen subscriptions plus VOD, which is a tier rather than a
        // service. Update deliberately: the number failing is the point.
        XCTAssertEqual(allPlatforms.count, 16)
    }

    /// VOD is the one tile that is not something you subscribe to, and the
    /// backend keys off exactly this string to widen the discover query.
    func testVODShipsUnderTheKeyTheBackendExpects() {
        let vod = allPlatforms.first { $0.key == "vod" }
        XCTAssertNotNil(vod, "the VOD tile is missing from the picker")
        XCTAssertEqual(vod?.name, "VOD")
    }

    /// The tile shipped once as "pvod". A stored selection is pruned against
    /// `knownPlatformKeys` on launch, so without the rename map that key would
    /// be dropped as unknown — the tile silently un-picking itself.
    func testASelectionSavedUnderTheOldPvodKeySurvivesTheRename() {
        defaults.set(["netflix", "pvod"], forKey: "mk_platforms")

        let app = AppState(userDefaults: defaults)

        XCTAssertEqual(app.selectedPlatforms, ["netflix", "vod"],
                       "the VOD tile reverted for anyone who had already picked it")
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
         "streamingOn":[],"certificate":null}
        """#)
        XCTAssertFalse(extras.hasContent, "an empty block would draw an empty section")
    }

    func testACertificateAloneIsWorthDrawingTheSectionFor() throws {
        let extras = try decode(WatchmodeExtras.self, #"""
        {"pros":null,"cons":null,"verdict":null,"rent":null,"buy":null,
         "streamingOn":[],"certificate":"R"}
        """#)
        XCTAssertTrue(extras.hasContent)
        XCTAssertEqual(extras.certificate, "R")
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

    /// The VOD tier arrived after the app shipped, so a server that predates it
    /// sends no `purchaseOn` at all — and a catalog item has to decode either way.
    func testACatalogItemDecodesWithAndWithoutStorefronts() throws {
        let withStores = try decode(CatalogItem.self, #"""
        {"id":"movie-1","title":"A Film","mediaType":"movie","year":2024,
         "availableOn":["Netflix"],
         "purchaseOn":[{"name":"Apple TV","tiers":["rent","buy"]},
                       {"name":"Amazon Video","tiers":["buy"]}]}
        """#)
        XCTAssertEqual(withStores.availableOn, ["Netflix"])
        XCTAssertEqual(withStores.purchaseOn?.map(\.name), ["Apple TV", "Amazon Video"])
        // The verb follows the offer: a store that only sells must not say Rent.
        XCTAssertEqual(withStores.purchaseOn?[0].label, "Rent · Apple TV")
        XCTAssertEqual(withStores.purchaseOn?[1].label, "Buy · Amazon Video")

        let older = try decode(CatalogItem.self, #"""
        {"id":"movie-2","title":"Another","mediaType":"movie","year":2024,
         "availableOn":["Netflix"]}
        """#)
        XCTAssertNil(older.purchaseOn)
    }

    /// A suggestion no subscription covers has an empty `availableOn`, so
    /// without the storefronts the card would say nothing about where to watch.
    func testADiscoveryCardCarriesStorefrontsWhenNothingStreamsIt() throws {
        let card = try decode(DiscoveryCard.self, #"""
        {"itemId":"movie-3","title":"Rent Only","year":2026,"mediaType":"movie",
         "posterUrl":null,"overview":null,"genres":[],"availableOn":[],
         "purchaseOn":[{"name":"Apple TV","tiers":["rent"]}],
         "ratings":null,"because":[],"tier":1,"exploration":false}
        """#)
        XCTAssertTrue(card.availableOn.isEmpty)
        XCTAssertEqual(card.purchaseOn?.map(\.name), ["Apple TV"])
    }

    /// The lookup button drives on `totalPending`, not on `pending`. Someone who
    /// imported only a watchlist has no history to resolve — and until the
    /// button appears and runs, none of those films are on the real watchlist
    /// either, so the page would offer nothing to press.
    func testTotalPendingCountsSavedFilmsAlongsideHistory() throws {
        let both = try decode(AnalyticsCoverage.self, #"""
        {"films":10,"resolved":4,"pending":6,"unmatched":0,"pendingWatchlist":3}
        """#)
        XCTAssertEqual(both.totalPending, 9)

        let watchlistOnly = try decode(AnalyticsCoverage.self, #"""
        {"films":0,"resolved":0,"pending":0,"unmatched":0,"pendingWatchlist":12}
        """#)
        XCTAssertEqual(watchlistOnly.totalPending, 12)
    }

    /// A server that predates the field sends no `pendingWatchlist` at all.
    func testCoverageFromABeforeSavedFilmsWereCountedStillDecodes() throws {
        let old = try decode(AnalyticsCoverage.self, #"""
        {"films":10,"resolved":4,"pending":6,"unmatched":0}
        """#)
        XCTAssertNil(old.pendingWatchlist)
        XCTAssertEqual(old.totalPending, 6)
    }

    /// Letterboxd leaves Year blank for a film with no release date yet. The
    /// preview keeps those rows now, so the client has to decode them — and a
    /// non-optional `year` would drop the title one layer above the fix.
    func testAPreviewRowWithNoYearStillDecodes() throws {
        let result = try decode(LetterboxdPreviewResult.self, #"""
        {"importType":"watchlist","count":2,"skipped":0,"undated":1,
         "items":[{"name":"Stalker","year":1979},{"name":"Sinners","year":null}]}
        """#)
        XCTAssertEqual(result.items.count, 2)
        XCTAssertEqual(result.items[0].year, 1979)
        XCTAssertNil(result.items[1].year)
        XCTAssertEqual(result.undated, 1)
    }

    /// The ordering arrived after the app shipped, so a server that predates it
    /// must still produce a page — one with fewer controls, not an error screen.
    func testABreakdownFromABeforeOrderingExistedStillDecodes() throws {
        let breakdown = try decode(AnalyticsBreakdown.self, #"""
        {"id":"directors","title":"Directors","unit":"director","filterKey":"director",
         "total":2,"needsLookup":true,"best":[],"worst":[],
         "entries":[{"name":"Akira Kurosawa","label":"Akira Kurosawa","films":7,
                     "rated":7,"meanRating":4.4,"crowdMean":null,"delta":0.6}]}
        """#)
        XCTAssertNil(breakdown.sort)
        XCTAssertNil(breakdown.minFilms)
        XCTAssertNil(breakdown.hidden)
        // The entry's new counters default rather than failing the whole decode.
        let entry = try XCTUnwrap(breakdown.entries.first)
        XCTAssertEqual(entry.liked, 0)
        XCTAssertEqual(entry.rewatches, 0)
        XCTAssertNil(entry.crowdDelta)
    }

    func testTheOrderingsAreReadWhenTheServerSendsThem() throws {
        let breakdown = try decode(AnalyticsBreakdown.self, #"""
        {"id":"cast","title":"Cast","unit":"actor","filterKey":"actor",
         "total":40,"needsLookup":true,"best":[],"worst":[],
         "sort":"rating","minFilms":3,"hidden":31,
         "entries":[{"name":"Toshiro Mifune","label":"Toshiro Mifune","films":9,
                     "rated":9,"meanRating":4.5,"crowdMean":7.8,"delta":0.7,
                     "crowdDelta":-0.3,"liked":4,"rewatches":2}]}
        """#)
        XCTAssertEqual(breakdown.sort, "rating")
        XCTAssertEqual(breakdown.minFilms, 3)
        // The count of what the floor removed is what lets the page explain a
        // missing name instead of leaving the reader to suspect the import.
        XCTAssertEqual(breakdown.hidden, 31)

        let entry = try XCTUnwrap(breakdown.entries.first)
        XCTAssertEqual(entry.liked, 4)
        XCTAssertEqual(entry.rewatches, 2)
        XCTAssertEqual(entry.crowdDelta, -0.3)
    }

    /// An ordering that drops unrated entries has to say so, because the control
    /// that goes with it — the evidence floor — is only shown for those.
    func testAnOrderingKnowsWhetherItNeedsARating() throws {
        let sorts = try decode([AnalyticsSort].self, #"""
        [{"id":"films","title":"Most watched","needsRating":false},
         {"id":"rating","title":"Highest rated","needsRating":true},
         {"id":"legacy","title":"From an older server"}]
        """#)
        XCTAssertEqual(sorts.map(\.needsRating), [false, true, false])
    }

    /// Every section below the headline numbers is optional, and a server that
    /// sends none of them still has to decode.
    func testAPayloadWithNoOptionalSectionsDecodes() throws {
        let response = try decode(AnalyticsResponse.self, #"""
        {"dimension":"overview","dimensions":[],
         "filters":{"applied":[],"available":{"languages":[],"genres":[],"decades":[],
                    "directors":[],"cast":[],"tags":[]}},
         "scope":{"films":0,"filmsTotal":0,"filtered":false},
         "coverage":{"films":0,"resolved":0,"pending":0,"unmatched":0,"needsResolution":[]},
         "summary":{"films":0,"viewings":0,"rated":0,"meanRating":null,"runtimeMinutes":0,
                    "tasteOffset":null,"comparedOn":0}}
        """#)
        XCTAssertEqual(response.dimension, "overview")
        XCTAssertEqual(response.summary.films, 0)
        XCTAssertNil(response.breakdown)
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

    // MARK: - Notices

    func testAFailureIsShownAndCanBeDismissed() {
        let app = AppState(userDefaults: defaults)
        XCTAssertNil(app.notice)

        app.report(failure: "Marking watched failed.")
        XCTAssertEqual(app.notice?.kind, .failure)
        XCTAssertEqual(app.notice?.message, "Marking watched failed.")

        app.dismissNotice()
        XCTAssertNil(app.notice)
    }

    func testAnExpiredSessionLogsOutInsteadOfShowingABanner() {
        let app = AppState(userDefaults: defaults)
        app.saveSession(token: "t", username: "someone")

        app.report(error: APIError.unauthorized, whileTrying: "Marking watched")

        // Being told to sign in again is not a banner — it is a state change.
        XCTAssertNil(app.notice)
        XCTAssertEqual(app.page, .auth)
    }

    func testAFailureCarriesTheServerMessageRatherThanAGenericOne() {
        let app = AppState(userDefaults: defaults)
        app.report(error: APIError.clientError(429, "Too many requests"), whileTrying: "Search")

        let message = app.notice?.message ?? ""
        XCTAssertTrue(message.contains("Search failed"), message)
        XCTAssertTrue(message.contains("Too many requests"), message)
    }

    /// A job still running has no dismiss timer, or a long import would lose
    /// the only sign it is still going.
    func testAJobInFlightStaysOnScreenWhileFinishedOnesExpire() {
        let app = AppState(userDefaults: defaults)

        app.report(progress: "Importing 5 files…")
        XCTAssertNil(app.notice?.autoDismissAfter)

        app.report(success: "Imported 412 films.")
        XCTAssertNotNil(app.notice?.autoDismissAfter)
        // Failures linger longer than successes; there is more to read.
        app.report(failure: "Import failed.")
        XCTAssertGreaterThan(app.notice?.autoDismissAfter ?? 0, 3)
    }

    func testANewNoticeReplacesTheOneBeforeIt() {
        let app = AppState(userDefaults: defaults)
        app.report(progress: "Importing…")
        let first = app.notice?.id

        app.report(success: "Done.")
        XCTAssertNotEqual(app.notice?.id, first, "the older notice was still on screen")
        XCTAssertEqual(app.notice?.kind, .success)
    }

    // MARK: - Import ownership

    /// The upload belongs to the app, not to the screen that starts it, so
    /// leaving the page cannot take the progress with it.
    func testTheImportFlagLivesOnTheAppRatherThanAScreen() {
        let app = AppState(userDefaults: defaults)
        XCTAssertFalse(app.isImportingDiary)

        app.importDiary(files: [.init(name: "ratings.csv", text: "Name,Year\nHeat,1995")])

        // In flight the moment it is asked for, and announced.
        XCTAssertTrue(app.isImportingDiary)
        XCTAssertEqual(app.notice?.kind, .progress)
    }

    /// The server replaces the whole diary on each import, so two at once would
    /// race to decide the history.
    func testASecondImportIsRefusedWhileOneIsRunning() {
        let app = AppState(userDefaults: defaults)
        let files: [LetterboxdExport.File] = [.init(name: "ratings.csv", text: "Name,Year\nHeat,1995")]

        app.importDiary(files: files)
        app.importDiary(files: files)

        XCTAssertEqual(app.notice?.kind, .failure)
        XCTAssertTrue((app.notice?.message ?? "").contains("already running"))
    }

    // MARK: - Discovery

    func testACardDecodesWithOnlyWhatTheServerAlwaysSends() throws {
        let card = try decode(DiscoveryCard.self, #"""
        {"itemId":"movie-949","title":"Heat","year":1995,"mediaType":"movie",
         "posterUrl":null,"overview":null,"genres":["Crime"],"availableOn":[],
         "ratings":null,"because":[],"tier":1,"exploration":false}
        """#)
        XCTAssertEqual(card.id, "movie-949")
        XCTAssertEqual(card.kind, .movie)
        XCTAssertTrue(card.because.isEmpty)
    }

    func testAReasonSurvivesAMissingDetail() throws {
        // The server omits `detail` for some reason kinds; the card must still
        // render rather than failing to decode the whole queue.
        let reason = try decode(DiscoveryReason.self, #"{"kind":"genre","value":"Crime"}"#)
        XCTAssertEqual(reason.value, "Crime")
        XCTAssertNil(reason.detail)
    }

    /// A queue built from the crowd must not present itself as personal.
    func testAProfileKnowsWhetherItIsActuallyAboutYou() throws {
        let crowd = try decode(DiscoveryProfile.self,
            #"{"basis":"crowd","ratedFilms":0,"films":0,"confidence":"none"}"#)
        XCTAssertFalse(crowd.isPersonal)

        let diary = try decode(DiscoveryProfile.self,
            #"{"basis":"diary","ratedFilms":412,"films":500,"confidence":"high"}"#)
        XCTAssertTrue(diary.isPersonal)
    }

    func testAnExhaustedQueueDecodesAsEmptyRatherThanFailing() throws {
        let response = try decode(DiscoveryResponse.self, #"""
        {"cards":[],"profile":{"basis":"crowd","ratedFilms":0,"films":0,"confidence":"none"},
         "exhausted":true}
        """#)
        XCTAssertTrue(response.cards.isEmpty)
        XCTAssertTrue(response.exhausted)
    }
}
