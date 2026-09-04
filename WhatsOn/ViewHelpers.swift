//
//  ViewHelpers.swift
//  WhatsOn
//
// The preview, and the view modifiers shared across the app.
//

import SwiftUI

// MARK: - Preview

#Preview {
    ContentView()
        .environment(ThemeManager.shared)
}

// MARK: - View Helpers

extension View {
    @ViewBuilder
    func disableAutocap() -> some View {
        #if os(iOS)
        self.textInputAutocapitalization(.never)
        #else
        self
        #endif
    }

    func glassSurface(radius: CGFloat = 18, interactive: Bool = false) -> some View {
        modifier(GlassSurface(radius: radius, interactive: interactive))
    }
}

struct GlassSurface: ViewModifier {
    let radius: CGFloat
    let interactive: Bool

    @ViewBuilder
    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        if interactive {
            content.glassEffect(.regular.interactive(), in: shape)
        } else {
            content.glassEffect(.regular, in: shape)
        }
    }
}
