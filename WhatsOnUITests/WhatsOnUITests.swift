//
//  WhatsOnUITests.swift
//  WhatsOnUITests
//

import XCTest

/// A launch smoke test.
///
/// Deliberately small and offline. Everything past the sign-in screen needs a
/// backend and an account, which would make this suite fail for reasons that
/// have nothing to do with the app; what it can check without either is that a
/// fresh install launches, stays up, and lands somewhere a new user can act —
/// which is what a template test asserting nothing could never have caught.
final class WhatsOnUITests: XCTestCase {

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    /// Matched on label across every element type rather than on `staticTexts`:
    /// the same words are a segment title in one place and a button in another,
    /// and which kind it is is a detail of the layout, not of this test.
    private func signInLabel(in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS[c] %@", "Sign In"))
            .firstMatch
    }

    func testAFreshLaunchReachesTheSignInScreen() throws {
        let app = XCUIApplication()
        app.launch()

        XCTAssertTrue(
            signInLabel(in: app).waitForExistence(timeout: 30),
            "a signed-out launch should land on the sign-in screen"
        )
        XCTAssertEqual(app.state, .runningForeground, "the app did not stay up after launch")
        XCTAssertTrue(app.textFields.firstMatch.exists, "no field to type a username into")
        XCTAssertTrue(app.secureTextFields.firstMatch.exists, "no field to type a password into")
    }

    func testTheSignInScreenSurvivesTheLargestTextSize() throws {
        // The app scales with the reader's text setting now, which is worth
        // nothing if the very first screen falls apart at the top of the range.
        let app = XCUIApplication()
        app.launchArguments += [
            "-UIPreferredContentSizeCategoryName",
            "UICTContentSizeCategoryAccessibilityXXXL",
        ]
        app.launch()

        XCTAssertTrue(
            signInLabel(in: app).waitForExistence(timeout: 30),
            "the sign-in screen did not render at the largest accessibility text size"
        )
        XCTAssertEqual(app.state, .runningForeground)
        // The fields are still there to be typed into, not pushed off-screen.
        XCTAssertTrue(app.textFields.firstMatch.exists, "the username field did not survive the largest text size")
        XCTAssertTrue(app.secureTextFields.firstMatch.exists, "the password field did not survive the largest text size")
    }
}
