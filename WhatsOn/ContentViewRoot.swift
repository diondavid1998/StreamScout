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
        // Above every screen rather than inside each one, so a failure raised
        // anywhere reaches the reader wherever they have navigated to since —
        // which is the point of moving long jobs off the view that started them.
        .overlay(alignment: .top) {
            if let notice = app.notice {
                NoticeBanner(notice: notice) { app.dismissNotice() }
                    .padding(.horizontal, 14)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.spring(response: 0.34, dampingFraction: 0.86), value: app.notice)
        .environment(app)
    }
}

/// One line of what just happened, over whatever is on screen.
///
/// Deliberately not an alert: an alert stops everything and demands a tap, and
/// most of what this carries — a toggle that did not save, an import that
/// finished — is worth knowing without being worth interrupting for. Failures
/// linger longer than successes and can be dismissed early; a job still running
/// shows a spinner and stays until it is done.
struct NoticeBanner: View {
    let notice: AppNotice
    let onDismiss: () -> Void

    private var tint: Color {
        switch notice.kind {
        case .failure:  Color(hex: "#C4562F")
        case .success:  Color(hex: "#2E9E6B")
        case .progress: .mkAccent
        }
    }

    private var icon: String {
        switch notice.kind {
        case .failure:  "exclamationmark.triangle.fill"
        case .success:  "checkmark.circle.fill"
        case .progress: "arrow.triangle.2.circlepath"
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            if notice.kind == .progress {
                ProgressView().scaleEffect(0.7).tint(tint)
                    .frame(width: 16, height: 16)
            } else {
                Image(systemName: icon).font(.footnote.weight(.bold)).foregroundColor(tint)
            }

            Text(notice.message)
                .font(.footnote)
                .foregroundColor(.mkText)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)

            // A job in flight has nothing to dismiss — it will clear itself when
            // it finishes, and letting it be swiped away would lose the only
            // sign that it is still going.
            if notice.kind != .progress {
                Button(action: onDismiss) {
                    Image(systemName: "xmark")
                        .font(.caption2.weight(.bold)).foregroundColor(.mkMuted)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Dismiss")
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 11)
        .background(Color.mkSurface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(tint.opacity(0.45), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.18), radius: 12, y: 4)
        // Read out as soon as it appears, since the whole point is that someone
        // looking at another part of the screen still finds out.
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isStaticText)
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
