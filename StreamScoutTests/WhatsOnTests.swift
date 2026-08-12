//
//  StreamScoreTests.swift
//  StreamScoreTests
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
}
