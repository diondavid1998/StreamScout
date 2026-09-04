//
//  PlatformsView.swift
//  WhatsOn
//
// Picking which services you subscribe to, and the tiles that represent them.
//

import SwiftUI

// MARK: - Platforms

struct PlatformsView: View {
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var selected: Set<String> = []
    @State private var selectedLangs: Set<String> = []
    @State private var isLoading = true
    @State private var isSaving  = false
    @State private var errorMsg: String?
    @State private var showLogoutAlert = false

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 12), count: 4)

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack(alignment: .center) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("STREAMING SETUP")
                        .font(.caption2.weight(.semibold))
                        .foregroundColor(.mkAccent)
                        .kerning(1.4)
                    Text(app.page == .platforms ? "Choose your services" : "Edit your services")
                        .font(.title3).bold()
                        .foregroundColor(.mkText)
                }
                Spacer()
                if app.page != .platforms {
                    IconButton(icon: "xmark") { dismiss() }
                }
                IconButton(icon: "rectangle.portrait.and.arrow.right") { showLogoutAlert = true }
            }
            .padding(.horizontal, 20)
            .padding(.top, 20)
            .padding(.bottom, 16)

            if isLoading {
                Spacer()
                ProgressView().tint(.mkAccent)
                Spacer()
            } else {
                ScrollView {
                    VStack(spacing: 20) {
                        VStack(spacing: 4) {
                            HStack(spacing: 4) {
                                Text("Select every service you subscribe to.")
                                    .font(.subheadline)
                                    .foregroundColor(.mkMuted)
                                    .multilineTextAlignment(.center)
                            }
                            HStack(spacing: 5) {
                                Image("WhatsOnLogo")
                                    .resizable()
                                    .scaledToFit()
                                    .frame(width: 16, height: 16)
                                    .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
                                Text(Brand.displayName)
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundColor(.mkAccent)
                                Text("will show titles available across your chosen platforms.")
                                    .font(.subheadline)
                                    .foregroundColor(.mkMuted)
                            }
                            .multilineTextAlignment(.center)
                        }
                        .padding(.horizontal, 16)

                        LazyVGrid(columns: columns, spacing: 12) {
                            ForEach(allPlatforms) { p in
                                PlatformTile(platform: p, isSelected: selected.contains(p.key)) {
                                    withAnimation(.spring(duration: 0.2)) {
                                        if selected.contains(p.key) { selected.remove(p.key) }
                                        else { selected.insert(p.key) }
                                    }
                                }
                            }
                        }
                        .padding(.horizontal, 16)

                        // Language selection
                        VStack(alignment: .leading, spacing: 12) {
                            Divider().overlay(Color.mkBorder).padding(.horizontal, 16)
                            VStack(alignment: .leading, spacing: 3) {
                                Text("LANGUAGES")
                                    .font(.caption2.weight(.semibold))
                                    .foregroundColor(.mkAccent)
                                    .kerning(1.4)
                                Text("Include titles in these languages (optional)")
                                    .font(.caption)
                                    .foregroundColor(.mkMuted)
                            }
                            .padding(.horizontal, 16)
                            let langCols = Array(repeating: GridItem(.flexible(), spacing: 10), count: 3)
                            LazyVGrid(columns: langCols, spacing: 10) {
                                ForEach(allLanguages) { lang in
                                    let isOn = selectedLangs.contains(lang.key)
                                    Button {
                                        withAnimation(.spring(duration: 0.2)) {
                                            if isOn { selectedLangs.remove(lang.key) }
                                            else    { selectedLangs.insert(lang.key) }
                                        }
                                    } label: {
                                        Text(lang.label)
                                            .font(.caption.weight(.semibold))
                                            .lineLimit(1).minimumScaleFactor(0.8)
                                            .frame(maxWidth: .infinity, minHeight: 38)
                                            .foregroundColor(isOn ? .mkAccent : .mkMuted)
                                            .background(
                                                RoundedRectangle(cornerRadius: 10)
                                                    .fill(isOn ? Color.mkAccent.opacity(0.12) : Color.mkSurface)
                                            )
                                            .overlay(
                                                RoundedRectangle(cornerRadius: 10)
                                                    .stroke(isOn ? Color.mkAccent.opacity(0.5) : Color.mkBorder, lineWidth: 1)
                                            )
                                    }
                                    .buttonStyle(ScaleButtonStyle())
                                }
                            }
                            .padding(.horizontal, 16)
                        }

                        if let err = errorMsg {
                            Text(err).font(.caption).foregroundColor(.mkAccent)
                        }

                        MKButton(
                            label: isSaving ? "Saving…" : "Save & Continue",
                            icon: "checkmark.circle.fill",
                            isLoading: isSaving
                        ) { Task { await save() } }
                        .padding(.horizontal, 20)
                        .padding(.bottom, 32)
                    }
                    .padding(.top, 8)
                }
            }
        }
        .task { await load() }
        .alert("Log Out", isPresented: $showLogoutAlert) {
            Button("Log Out", role: .destructive) { app.logout() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Are you sure you want to log out?")
        }
    }

    @MainActor func load() async {
        isLoading = true; errorMsg = nil
        do {
            let resp: PlatformResponse = try await APIService.shared.get("/platforms", token: app.token)
            selected = Set(resp.platforms)
            selectedLangs = Set(resp.languages ?? [])
            app.savePlatforms(resp.platforms)
            app.saveLanguages(resp.languages ?? [])
        } catch {
            // Pre-fill with locally cached platforms if network fails
            if !app.selectedPlatforms.isEmpty {
                selected = Set(app.selectedPlatforms)
                selectedLangs = Set(app.selectedLanguages)
            } else {
                errorMsg = "Couldn't load saved services. Select yours below."
            }
        }
        isLoading = false
    }

    @MainActor func save() async {
        guard !selected.isEmpty else { errorMsg = "Select at least one service."; return }
        isSaving = true; errorMsg = nil
        let platforms = Array(selected)
        let languages = Array(selectedLangs)
        app.savePlatforms(platforms)
        app.saveLanguages(languages)
        do {
            _ = try await APIService.shared.put(
                "/platforms",
                body: ["platforms": platforms, "languages": languages],
                token: app.token
            ) as GenericResponse
        } catch let err as APIError {
            isSaving = false
            if case .unauthorized = err {
                app.logout()
                return
            }
            // Stay on this screen so the message is visible and the user can
            // retry. Navigating away here left the catalog built from the old
            // server-side selection with nothing explaining the mismatch.
            errorMsg = "Couldn't save your services. Tap Save to try again."
            return
        } catch {
            isSaving = false
            errorMsg = "Couldn't save your services. Tap Save to try again."
            return
        }
        isSaving = false
        if app.page == .platforms {
            app.page = .catalog
        } else {
            dismiss()
        }
    }
}

/// A service's logo, or a tinted monogram when no artwork is bundled for it.
/// The backend supports more services than the app ships logos for; those are
/// still selectable rather than being hidden from the picker.
struct PlatformArtwork: View {
    let platform: StreamingPlatform
    var size: CGFloat = 46
    var cornerRadius: CGFloat = 10

    var body: some View {
        Group {
            if let asset = platform.logoAsset {
                Image(asset)
                    .resizable()
                    .scaledToFit()
            } else {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(platform.accentColor.opacity(0.28))
                    .overlay(
                        // A monogram is part of the tile, not copy: it is sized from
                        // the tile and already has minimumScaleFactor to fit.
                        Text(platform.monogram)
                            .font(.system(size: size * 0.36, weight: .bold, design: .rounded))
                            .foregroundColor(.mkText)
                            .minimumScaleFactor(0.6)
                            .lineLimit(1)
                            .padding(2)
                    )
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
    }
}

struct PlatformTile: View {
    let platform: StreamingPlatform
    let isSelected: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(spacing: 6) {
                ZStack {
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(isSelected ? platform.accentColor.opacity(0.30) : Color.mkCard)
                        .overlay(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .stroke(
                                    isSelected ? platform.accentColor.opacity(0.8) : Color.mkBorder,
                                    lineWidth: isSelected ? 1.5 : 1
                                )
                        )
                        .frame(width: 62, height: 62)

                    PlatformArtwork(platform: platform, size: 46, cornerRadius: 10)

                    if isSelected {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.footnote)
                            .foregroundColor(.mkText)
                            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                            .padding(4)
                    }
                }

                Text(platform.name)
                    .font(.caption2.weight(.medium))
                    .foregroundColor(isSelected ? .mkText : .mkMuted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
        }
        .buttonStyle(ScaleButtonStyle())
    }
}
