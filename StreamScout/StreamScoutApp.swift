//
//  StreamScoreApp.swift
//  StreamScore
//
//  Created by Dion David on 4/7/26.
//

import SwiftUI
import CoreImage
import CoreImage.CIFilterBuiltins
import UIKit

@main
struct StreamScoutApp: App {
    @StateObject private var themeManager = ThemeManager.shared

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(themeManager)
                .preferredColorScheme(.dark)
        }
    }
}

// MARK: - Themes

struct AppTheme: Identifiable, Equatable {
    let id: String
    let name: String
    let background: Color
    let surface: Color
    let card: Color
    let accent: Color
    let accentAlt: Color
    let onAccent: Color
    let text: Color
    let muted: Color
    let border: Color
    let tv: Color

    static let signatureViolet = AppTheme(
        id: "signature_violet",
        name: "Signature Violet",
        background: Color(hex: "#0A0B14"),
        surface: Color(hex: "#121525"),
        card: Color(hex: "#171B2E"),
        accent: Color(hex: "#8C7BFF"),
        accentAlt: Color(hex: "#5B8CFF"),
        onAccent: .white,
        text: Color(hex: "#EEF1FF"),
        muted: Color(hex: "#8F98B5"),
        border: Color.white.opacity(0.09),
        tv: Color(hex: "#5EA6FF")
    )

    static let midnightBlue = AppTheme(
        id: "midnight_blue",
        name: "Midnight Blue",
        background: Color(hex: "#06080F"),
        surface: Color(hex: "#0E1322"),
        card: Color(hex: "#151B2E"),
        accent: Color(hex: "#5B8CFF"),
        accentAlt: Color(hex: "#3B5BDB"),
        onAccent: .white,
        text: Color(hex: "#EAF0FF"),
        muted: Color(hex: "#8997B8"),
        border: Color.white.opacity(0.1),
        tv: Color(hex: "#69B4FF")
    )

    static let sunsetAmber = AppTheme(
        id: "sunset_amber",
        name: "Sunset Amber",
        background: Color(hex: "#120C0A"),
        surface: Color(hex: "#1D1512"),
        card: Color(hex: "#281D1A"),
        accent: Color(hex: "#FF8A5B"),
        accentAlt: Color(hex: "#FF5E9E"),
        onAccent: .white,
        text: Color(hex: "#FFF0EA"),
        muted: Color(hex: "#C7A093"),
        border: Color.white.opacity(0.1),
        tv: Color(hex: "#5EA6FF")
    )

    static let oceanTeal = AppTheme(
        id: "ocean_teal",
        name: "Ocean Teal",
        background: Color(hex: "#05100F"),
        surface: Color(hex: "#0D1B1A"),
        card: Color(hex: "#132523"),
        accent: Color(hex: "#2FD9C4"),
        accentAlt: Color(hex: "#3E9BFF"),
        onAccent: .white,
        text: Color(hex: "#E8FFF9"),
        muted: Color(hex: "#8FBDB7"),
        border: Color.white.opacity(0.1),
        tv: Color(hex: "#62B1FF")
    )

    static let crimsonNoir = AppTheme(
        id: "crimson_noir",
        name: "Crimson Noir",
        background: Color(hex: "#0B0B0B"),
        surface: Color(hex: "#151214"),
        card: Color(hex: "#1F171B"),
        accent: Color(hex: "#E23A55"),
        accentAlt: Color(hex: "#8C1024"),
        onAccent: .white,
        text: Color(hex: "#F9EEF1"),
        muted: Color(hex: "#B48D97"),
        border: Color.white.opacity(0.1),
        tv: Color(hex: "#5EA6FF")
    )

    static let graphiteMinimal = AppTheme(
        id: "graphite_minimal",
        name: "Graphite Minimal",
        background: Color(hex: "#0C0D10"),
        surface: Color(hex: "#15171C"),
        card: Color(hex: "#1D2027"),
        accent: Color(hex: "#9AA2B6"),
        accentAlt: Color(hex: "#5A6072"),
        onAccent: .white,
        text: Color(hex: "#F0F2F7"),
        muted: Color(hex: "#9AA2B6"),
        border: Color.white.opacity(0.1),
        tv: Color(hex: "#6CAEFF")
    )

    static let monochrome = AppTheme(
        id: "monochrome",
        name: "Monochrome",
        background: Color(hex: "#000000"),
        surface: Color(hex: "#101010"),
        card: Color(hex: "#181818"),
        accent: Color(hex: "#FFFFFF"),
        accentAlt: Color(hex: "#B0B0B0"),
        onAccent: .black,
        text: Color(hex: "#F2F2F2"),
        muted: Color(hex: "#9A9A9A"),
        border: Color.white.opacity(0.18),
        tv: Color(hex: "#6CAEFF")
    )

    static let vibrantNeon = AppTheme(
        id: "vibrant_neon",
        name: "Vibrant Neon",
        background: Color(hex: "#0A0512"),
        surface: Color(hex: "#151025"),
        card: Color(hex: "#201632"),
        accent: Color(hex: "#B24BFF"),
        accentAlt: Color(hex: "#3EE0FF"),
        onAccent: .white,
        text: Color(hex: "#F7EEFF"),
        muted: Color(hex: "#B59BC9"),
        border: Color.white.opacity(0.1),
        tv: Color(hex: "#54B0FF")
    )

    static let all: [AppTheme] = [
        .signatureViolet,
        .midnightBlue,
        .sunsetAmber,
        .oceanTeal,
        .crimsonNoir,
        .graphiteMinimal,
        .monochrome,
        .vibrantNeon
    ]

    static let defaultTheme: AppTheme = .signatureViolet

    static func theme(with id: String) -> AppTheme {
        all.first(where: { $0.id == id }) ?? defaultTheme
    }
}

final class ThemeManager: ObservableObject {
    static let shared = ThemeManager()
    @Published private(set) var current: AppTheme = .defaultTheme

    private init() {}

    func applyTheme(id: String) {
        applyTheme(AppTheme.theme(with: id))
    }

    func applyTheme(_ theme: AppTheme) {
        current = theme
    }
}

// MARK: - Design Tokens

extension Color {
    init(hex: String) {
        var hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        if hex.count == 3 {
            hex = hex.map { "\($0)\($0)" }.joined()
        }
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        self.init(
            red: Double((int >> 16) & 0xFF) / 255.0,
            green: Double((int >> 8) & 0xFF) / 255.0,
            blue: Double(int & 0xFF) / 255.0
        )
    }

    static var mkBackground: Color { ThemeManager.shared.current.background }
    static var mkSurface: Color { ThemeManager.shared.current.surface }
    static var mkCard: Color { ThemeManager.shared.current.card }
    static var mkAccent: Color { ThemeManager.shared.current.accent }
    static var mkAccentAlt: Color { ThemeManager.shared.current.accentAlt }
    static var mkOnAccent: Color { ThemeManager.shared.current.onAccent }
    static var mkText: Color { ThemeManager.shared.current.text }
    static var mkMuted: Color { ThemeManager.shared.current.muted }
    static var mkBorder: Color { ThemeManager.shared.current.border }
    static var mkTV: Color { ThemeManager.shared.current.tv }
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
    .init(id: "netflix",     key: "netflix",     name: "Netflix",     logoAsset: "netflix",      accentColor: Color(red: 0.898, green: 0.031, blue: 0.078)),
    .init(id: "hulu",        key: "hulu",        name: "Hulu",        logoAsset: "hulu",         accentColor: Color(red: 0.110, green: 0.910, blue: 0.514)),
    .init(id: "prime",       key: "prime",       name: "Prime Video", logoAsset: "prime",        accentColor: Color(red: 0.000, green: 0.659, blue: 0.882)),
    .init(id: "disney",      key: "disney",      name: "Disney+",     logoAsset: "disneyplus",   accentColor: Color(red: 0.067, green: 0.235, blue: 0.812)),
    .init(id: "apple",       key: "apple",       name: "Apple TV+",   logoAsset: "appletv",      accentColor: Color(red: 0.800, green: 0.800, blue: 0.800)),
    .init(id: "max",         key: "max",         name: "Max",         logoAsset: "max",          accentColor: Color(red: 0.000, green: 0.169, blue: 0.906)),
    .init(id: "peacock",     key: "peacock",     name: "Peacock",     logoAsset: "peacock",      accentColor: Color(red: 0.000, green: 0.784, blue: 1.000)),
    .init(id: "paramount",   key: "paramount",   name: "Paramount+",  logoAsset: "paramountplus", accentColor: Color(red: 0.000, green: 0.392, blue: 1.000)),
    .init(id: "crunchyroll", key: "crunchyroll", name: "Crunchyroll", logoAsset: "crunchyroll",  accentColor: Color(red: 0.957, green: 0.459, blue: 0.129)),
    .init(id: "tubi",        key: "tubi",        name: "Tubi",        logoAsset: "tubi",         accentColor: Color(red: 0.949, green: 0.318, blue: 0.071)),
]

// MARK: - Dominant Color Cache

/// Extracts and caches the average/dominant color from poster images.
/// Results are keyed by poster URL string and held for the lifetime of the session.
@MainActor
final class ColorCache: ObservableObject {
    static let shared = ColorCache()
    private init() {}

    private var cache: [String: Color] = [:]
    private var inFlight: [String: Task<Color?, Never>] = [:]

    /// Returns the cached color for `urlString` if available, otherwise returns `nil`
    /// and triggers a background fetch. Subscribe to the cache via `@ObservedObject`
    /// or poll via `.task(id:)` to get the result when ready.
    func cachedColor(for urlString: String) -> Color? {
        cache[urlString]
    }

    /// Fetches the dominant color for `urlString`, either from cache or by downloading
    /// the image and running `CIAreaAverage`. Safe to call multiple times — in-flight
    /// requests are deduplicated.
    func fetchColor(for urlString: String) async -> Color? {
        if let cached = cache[urlString] { return cached }
        if let task = inFlight[urlString] { return await task.value }

        let task = Task<Color?, Never> {
            guard let url = URL(string: urlString),
                  let (data, _) = try? await URLSession.shared.data(from: url),
                  let uiImage = UIImage(data: data),
                  let color = Self.averageColor(of: uiImage) else { return nil }
            return color
        }
        inFlight[urlString] = task
        let color = await task.value
        inFlight.removeValue(forKey: urlString)
        if let color { cache[urlString] = color }
        return color
    }

    /// Uses `CIAreaAverage` on a 16×16 downsampled version of the image to compute
    /// a representative dominant color cheaply.
    private static func averageColor(of image: UIImage) -> Color? {
        // Downsample to 16×16 to make CIAreaAverage fast
        let targetSize = CGSize(width: 16, height: 16)
        let renderer = UIGraphicsImageRenderer(size: targetSize)
        let small = renderer.image { _ in image.draw(in: CGRect(origin: .zero, size: targetSize)) }

        guard let ciImage = CIImage(image: small) else { return nil }
        let extent = CIVector(cgRect: ciImage.extent)
        let filter = CIFilter.areaAverage()
        filter.inputImage = ciImage
        filter.extent = extent
        guard let output = filter.outputImage else { return nil }

        var bitmap = [UInt8](repeating: 0, count: 4)
        let context = CIContext(options: [.workingColorSpace: NSNull()])
        context.render(
            output,
            toBitmap: &bitmap,
            rowBytes: 4,
            bounds: CGRect(x: 0, y: 0, width: 1, height: 1),
            format: .RGBA8,
            colorSpace: CGColorSpaceCreateDeviceRGB()
        )

        // Boost saturation: pull the color toward a more vivid version
        let r = Double(bitmap[0]) / 255.0
        let g = Double(bitmap[1]) / 255.0
        let b = Double(bitmap[2]) / 255.0

        // Simple saturation boost — shift each channel away from the average
        let avg = (r + g + b) / 3.0
        let boost = 1.6
        let br = min(1.0, max(0, avg + (r - avg) * boost))
        let bg = min(1.0, max(0, avg + (g - avg) * boost))
        let bb = min(1.0, max(0, avg + (b - avg) * boost))

        return Color(.sRGB, red: br, green: bg, blue: bb, opacity: 1)
    }
}
