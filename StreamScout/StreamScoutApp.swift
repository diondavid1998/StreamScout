//
//  StreamScoreApp.swift
//  StreamScore
//
//  Created by Dion David on 4/7/26.
//

import SwiftUI

@main
struct StreamScoutApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
                .preferredColorScheme(.dark)
        }
    }
}

// MARK: - Design Tokens

extension Color {
    static let mkBackground = Color(red: 0.043, green: 0.047, blue: 0.067)  // #0b0c11
    static let mkSurface    = Color(red: 0.063, green: 0.075, blue: 0.110)  // #10131c
    static let mkCard       = Color(red: 0.078, green: 0.090, blue: 0.130)  // slightly lighter surface
    static let mkAccent     = Color(red: 0.914, green: 0.271, blue: 0.376)  // #e94560
    static let mkAccentAlt  = Color(red: 1.000, green: 0.549, blue: 0.376)  // #ff8c61
    static let mkText       = Color(red: 0.933, green: 0.941, blue: 0.969)  // #eef0f7
    static let mkMuted      = Color(red: 0.431, green: 0.478, blue: 0.576)  // #6e7a93
    static let mkBorder     = Color.white.opacity(0.07)
    static let mkTV         = Color(red: 0.369, green: 0.651, blue: 1.000)  // #5ea6ff
}

// MARK: - Streaming Platforms

struct StreamingPlatform: Identifiable {
    let id: String
    let key: String
    let name: String
    let logoAsset: String   // Must match name in Assets.xcassets
    let accentColor: Color
}

// MARK: - Languages

struct AppLanguage: Identifiable {
    let id: String
    let key: String
    let label: String
}

let allLanguages: [AppLanguage] = [
    .init(id: "en", key: "en", label: "English"),
    .init(id: "es", key: "es", label: "Spanish"),
    .init(id: "fr", key: "fr", label: "French"),
    .init(id: "de", key: "de", label: "German"),
    .init(id: "it", key: "it", label: "Italian"),
    .init(id: "pt", key: "pt", label: "Portuguese"),
    .init(id: "ja", key: "ja", label: "Japanese"),
    .init(id: "ko", key: "ko", label: "Korean"),
    .init(id: "hi", key: "hi", label: "Hindi"),
    .init(id: "zh", key: "zh", label: "Mandarin"),
    .init(id: "cn", key: "cn", label: "Cantonese"),
    .init(id: "ta", key: "ta", label: "Tamil"),
    .init(id: "te", key: "te", label: "Telugu"),
    .init(id: "ml", key: "ml", label: "Malayalam"),
]

// MARK: - Streaming Platforms

let allPlatforms: [StreamingPlatform] = [
    .init(id: "netflix",     key: "netflix",     name: "Netflix",     logoAsset: "netflix",     accentColor: Color(red: 0.898, green: 0.031, blue: 0.078)),
    .init(id: "hulu",        key: "hulu",        name: "Hulu",        logoAsset: "hulu",        accentColor: Color(red: 0.110, green: 0.910, blue: 0.514)),
    .init(id: "prime",       key: "prime",       name: "Prime Video", logoAsset: "prime",       accentColor: Color(red: 0.000, green: 0.659, blue: 0.882)),
    .init(id: "disney",      key: "disney",      name: "Disney+",     logoAsset: "disneyplus",     accentColor: Color(red: 0.067, green: 0.235, blue: 0.812)),
    .init(id: "appletv",     key: "appletv",     name: "Apple TV+",   logoAsset: "appletv",     accentColor: Color(red: 0.800, green: 0.800, blue: 0.800)),
    .init(id: "max",         key: "max",         name: "Max",         logoAsset: "max",         accentColor: Color(red: 0.000, green: 0.169, blue: 0.906)),
    .init(id: "peacock",     key: "peacock",     name: "Peacock",     logoAsset: "peacock",     accentColor: Color(red: 0.000, green: 0.784, blue: 1.000)),
    .init(id: "paramount",   key: "paramount",   name: "Paramount+",  logoAsset: "paramountplus",  accentColor: Color(red: 0.000, green: 0.392, blue: 1.000)),
    .init(id: "crunchyroll", key: "crunchyroll", name: "Crunchyroll", logoAsset: "crunchyroll", accentColor: Color(red: 0.957, green: 0.459, blue: 0.129)),
]
