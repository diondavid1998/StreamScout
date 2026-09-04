//
//  ContentViewRoot.swift
//  WhatsOn
//
// The router, and the two screens that stand in while it decides: the wordmark
// and the loading view.
//

import SwiftUI

// MARK: - Root Router

struct ContentView: View {
    @State private var app = AppState()
    @Environment(ThemeManager.self) private var themeManager

    var body: some View {
        ZStack {
            themeManager.current.background.ignoresSafeArea()
            switch app.page {
            case .loading:   LoadingView()
            case .auth:      AuthView()
            case .platforms: PlatformsView()
            case .catalog:   CatalogView()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .environment(app)
    }
}

// MARK: - Loading

/// Reusable inline WhatsOn brand header (logo + name side by side)
struct WhatsOnTitle: View {
    var size: CGFloat = 28
    var logoSize: CGFloat = 32

    var body: some View {
        HStack(spacing: 10) {
            Image("WhatsOnLogo")
                .resizable()
                .scaledToFit()
                .frame(width: logoSize, height: logoSize)
                .clipShape(RoundedRectangle(cornerRadius: logoSize * 0.22, style: .continuous))
                .shadow(color: .mkAccent.opacity(0.4), radius: 6, x: 0, y: 3)
                // Sized from the graphic it sits in rather than from the reader's
                // text setting: this is a wordmark, and scaling it independently
                // would push it out of a frame that does not move.
            Text(Brand.displayName)
                .font(.system(size: size, weight: .bold, design: .rounded))
                .foregroundStyle(LinearGradient(colors: [.mkAccent, .mkAccentAlt], startPoint: .leading, endPoint: .trailing))
        }
    }
}

struct LoadingView: View {
    var body: some View {
        VStack(spacing: 16) {
            WhatsOnTitle(size: 30, logoSize: 34)
            ProgressView().tint(.mkAccent).padding(.top, 8)
        }
    }
}
