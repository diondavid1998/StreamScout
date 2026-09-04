//
//  SettingsView.swift
//  WhatsOn
//
// Settings, and the five tabs inside it: services, appearance, profile, and the
// watched and watchlist views.
//

import SwiftUI
import PhotosUI
import UIKit

// MARK: - Settings View

struct SettingsView: View {
    enum Tab: String { case services, appearance, profile, watched, watchlistTab }
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var tab: Tab = .services
    @Namespace private var tabGlass

    var body: some View {
        NavigationStack {
            ZStack {
                Color.mkBackground.ignoresSafeArea()
                VStack(spacing: 0) {
                    tabPicker.padding(.horizontal, 16).padding(.vertical, 10)
                    Divider().overlay(Color.mkBorder)
                    Group {
                        switch tab {
                        case .services:    ServicesTabView().environment(app)
                        case .appearance:  AppearanceTabView().environment(app)
                        case .profile:     ProfileTabView().environment(app)
                        case .watched:     WatchedOnlyTabView().environment(app)
                        case .watchlistTab: WatchlistOnlyTabView().environment(app)
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .animation(.easeInOut(duration: 0.2), value: tab)
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") { dismiss() }.fontWeight(.semibold).foregroundColor(.mkAccent)
                }
            }
        }
    }

    var tabPicker: some View {
        GlassEffectContainer {
            HStack(spacing: 4) {
                ForEach([(Tab.services, "play.rectangle.on.rectangle", "Services"),
                         (Tab.appearance, "paintpalette", "Color"),
                         (Tab.profile, "person.crop.circle", "Profile"),
                         (Tab.watched, "checkmark.circle", "Watched"),
                         (Tab.watchlistTab, "bookmark.circle", "Watchlist")], id: \.0.rawValue) { t, icon, label in
                    let isSelected = tab == t
                    Button {
                        withAnimation(.easeInOut(duration: 0.2)) { tab = t }
                    } label: {
                        VStack(spacing: 4) {
                            Image(systemName: icon).font(.callout)
                            Text(label).font(.caption.weight(.semibold))
                        }
                        .foregroundColor(isSelected ? .mkText : .mkMuted)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .glassEffect(
                        isSelected ? .regular.tint(.mkAccent).interactive() : .clear,
                        in: RoundedRectangle(cornerRadius: 12, style: .continuous)
                    )
                    .glassEffectID(t.rawValue, in: tabGlass)
                }
            }
        }
        .padding(4)
        .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

// MARK: Appearance Tab

struct AppearanceTabView: View {
    @Environment(AppState.self) private var app

    private let columns = [
        GridItem(.flexible(), spacing: 12),
        GridItem(.flexible(), spacing: 12)
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text("Color").font(.title3).bold().foregroundColor(.mkText).padding(.top, 4)
                Text("Choose a color theme for WhatsOn.")
                    .font(.subheadline)
                    .foregroundColor(.mkMuted)

                LazyVGrid(columns: columns, spacing: 12) {
                    ForEach(AppTheme.all) { theme in
                        Button {
                            app.saveTheme(theme.id)
                        } label: {
                            VStack(alignment: .leading, spacing: 10) {
                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    .fill(
                                        LinearGradient(
                                            colors: [theme.accent, theme.accentAlt],
                                            startPoint: .topLeading,
                                            endPoint: .bottomTrailing
                                        )
                                    )
                                    .frame(height: 56)
                                    .overlay(alignment: .topTrailing) {
                                        if app.selectedThemeId == theme.id {
                                            Image(systemName: "checkmark.circle.fill")
                                                .font(.title3)
                                                .foregroundColor(theme.onAccent)
                                                .padding(8)
                                        }
                                    }

                                HStack(spacing: 8) {
                                    // Ringed, because a light theme's background
                                    // dot is invisible on a light surface.
                                    Circle()
                                        .fill(theme.background)
                                        .overlay(Circle().stroke(Color.mkHairline, lineWidth: 1))
                                        .frame(width: 10, height: 10)
                                    Text(theme.name)
                                        .font(.footnote.weight(.semibold))
                                        .foregroundColor(app.selectedThemeId == theme.id ? .mkAccent : .mkText)
                                        .lineLimit(2)
                                }
                            }
                            .padding(10)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color.mkSurface)
                            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: 14, style: .continuous)
                                    .stroke(app.selectedThemeId == theme.id ? Color.mkAccent.opacity(0.6) : Color.mkBorder, lineWidth: 1)
                            )
                        }
                        .buttonStyle(ScaleButtonStyle())
                    }
                }
                .padding(.bottom, 24)
            }
            .padding(.horizontal, 16)
            .padding(.top, 12)
        }
    }
}

// MARK: Services Tab

struct ServicesTabView: View {
    @Environment(AppState.self) private var app
    @State private var isSaving = false
    @State private var savedMsg = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text("Streaming Services").font(.title3).bold().foregroundColor(.mkText).padding(.top, 4)
                Text("Select every service you subscribe to.").font(.subheadline).foregroundColor(.mkMuted)
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: 3), spacing: 12) {
                    ForEach(allPlatforms) { platform in
                        PlatformToggle(platform: platform, isSelected: app.selectedPlatforms.contains(platform.key)) {
                            let updated = app.selectedPlatforms.contains(platform.key)
                                ? app.selectedPlatforms.filter { $0 != platform.key }
                                : app.selectedPlatforms + [platform.key]
                            app.savePlatforms(updated)
                        }
                    }
                }
                .padding(.horizontal, 2)
                Text("Content Languages").font(.title3).bold().foregroundColor(.mkText)
                Text("Filter catalog by language preference.").font(.subheadline).foregroundColor(.mkMuted)
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: 3), spacing: 12) {
                    ForEach(allLanguages) { lang in
                        LanguageToggle(language: lang, isSelected: app.selectedLanguages.contains(lang.key)) {
                            let updated = app.selectedLanguages.contains(lang.key)
                                ? app.selectedLanguages.filter { $0 != lang.key }
                                : app.selectedLanguages + [lang.key]
                            app.saveLanguages(updated)
                        }
                    }
                }
                .padding(.horizontal, 2)
                if !savedMsg.isEmpty {
                    Text(savedMsg).font(.subheadline).foregroundColor(.green).frame(maxWidth: .infinity)
                }
                MKButton(label: "Save Services", icon: "checkmark.circle.fill", isLoading: isSaving) {
                    Task { await saveServices() }
                }
                .padding(.bottom, 24)
            }
            .padding(.horizontal, 16).padding(.top, 12)
        }
    }

    @MainActor func saveServices() async {
        isSaving = true
        do {
            let body: [String: Any] = [
                "platforms": app.selectedPlatforms,
                "languages": app.selectedLanguages
            ]
            let _: GenericResponse = try await APIService.shared.put("/platforms", body: body, token: app.token)
            savedMsg = "Saved ✓"
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { savedMsg = "" }
        } catch { savedMsg = "Save failed" }
        isSaving = false
    }
}

struct PlatformToggle: View {
    let platform: StreamingPlatform
    let isSelected: Bool
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            VStack(spacing: 6) {
                PlatformArtwork(platform: platform, size: 44, cornerRadius: 10)
                    .overlay(RoundedRectangle(cornerRadius: 10)
                        .stroke(isSelected ? Color.mkAccent.opacity(0.9) : Color.clear, lineWidth: 2))
                Text(platform.name).font(.caption2.weight(.semibold))
                    .foregroundColor(isSelected ? .mkText : .mkMuted)
                    .lineLimit(1).minimumScaleFactor(0.7)
                    .frame(maxWidth: .infinity)
            }
            .padding(10)
            .frame(maxWidth: .infinity, minHeight: 80)
            .background(
                isSelected ? Color.mkAccent.opacity(0.22) : Color.mkCard,
                in: RoundedRectangle(cornerRadius: 14, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(isSelected ? Color.mkAccent.opacity(0.85) : Color.mkBorder,
                            lineWidth: isSelected ? 1.5 : 1)
            )
        }
        .buttonStyle(ScaleButtonStyle())
    }
}

struct LanguageToggle: View {
    let language: AppLanguage
    let isSelected: Bool
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(language.label)
                .font(.footnote.weight(.semibold))
                .foregroundColor(isSelected ? .mkText : .mkMuted)
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(
                    isSelected ? Color.mkAccent.opacity(0.22) : Color.mkCard,
                    in: RoundedRectangle(cornerRadius: 12, style: .continuous)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(isSelected ? Color.mkAccent.opacity(0.85) : Color.mkBorder,
                                lineWidth: isSelected ? 1.5 : 1)
                )
        }
        .buttonStyle(ScaleButtonStyle())
    }
}

// MARK: Profile Tab

struct ProfileTabView: View {
    @Environment(AppState.self) private var app
    @State private var username = ""
    @State private var email = ""
    @State private var currentPassword = ""
    @State private var newPassword = ""
    @State private var isSaving = false
    @State private var message = ""
    @State private var messageIsError = false
    @State private var avatarItem: PhotosPickerItem?
    @State private var avatarUIImage: UIImage?
    @State private var profilePicBase64: String?
    @State private var isLoadingAccount = true
    // Letterboxd import
    @State private var showFileImporter = false
    @State private var lbxIntendedType = "watched"
    @State private var lbxImportType = ""
    @State private var lbxItems: [[String: Any]] = []
    @State private var showLbxConfirm = false
    @State private var showLbxMismatch = false
    @State private var lbxImportProgress: String? = nil
    @State private var lbxImportDone: String? = nil
    // Catalog refresh
    @State private var showRefreshConfirm = false
    @State private var isRefreshing = false

    var body: some View {
        ScrollView {
            if isLoadingAccount {
                ProgressView().padding(.top, 60).frame(maxWidth: .infinity)
            } else {
            VStack(spacing: 20) {
                avatarSection
                VStack(spacing: 14) {
                    MKTextField(placeholder: "Username", text: $username, icon: "person")
                    MKTextField(placeholder: "Email address", text: $email, icon: "envelope")
                    Divider().overlay(Color.mkBorder)
                    Text("Change Password").font(.subheadline).foregroundColor(.mkMuted).frame(maxWidth: .infinity, alignment: .leading)
                    MKTextField(placeholder: "Current password", text: $currentPassword, icon: "lock", isSecure: true)
                    MKTextField(placeholder: "New password", text: $newPassword, icon: "lock.open", isSecure: true)
                }
                if !message.isEmpty {
                    Text(message)
                        .font(.subheadline)
                        .foregroundColor(messageIsError ? .red : .green)
                        .frame(maxWidth: .infinity)
                }
                MKButton(label: "Save Changes", icon: "checkmark.circle.fill", isLoading: isSaving) {
                    Task { await saveProfile() }
                }

                Divider().overlay(Color.mkBorder)

                // ── Letterboxd Import ──────────────────────────────────────
                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 8) {
                        Image(systemName: "square.and.arrow.down")
                            .foregroundColor(.mkAccent)
                        Text("Letterboxd Import")
                            .font(.subheadline.weight(.semibold))
                            .foregroundColor(.mkText)
                    }
                    Text("Export your watched.csv or watchlist.csv from Letterboxd (letterboxd.com/settings/data) and use the matching button above.")
                        .font(.caption)
                        .foregroundColor(.mkMuted)
                        .fixedSize(horizontal: false, vertical: true)

                    if let progress = lbxImportProgress {
                        HStack(spacing: 8) {
                            ProgressView().tint(.mkAccent).scaleEffect(0.8)
                            Text(progress).font(.caption).foregroundColor(.mkMuted)
                        }
                    } else if let done = lbxImportDone {
                        Text(done).font(.caption).foregroundColor(.green)
                    }

                    HStack(spacing: 10) {
                        MKButton(label: "Import Watched", icon: "eye.fill",
                                 isLoading: lbxImportProgress != nil && lbxIntendedType == "watched",
                                 isDisabled: lbxImportProgress != nil) {
                            lbxIntendedType = "watched"
                            showFileImporter = true
                        }
                        MKButton(label: "Import Watchlist", icon: "bookmark.fill",
                                 isLoading: lbxImportProgress != nil && lbxIntendedType == "watchlist",
                                 isDisabled: lbxImportProgress != nil) {
                            lbxIntendedType = "watchlist"
                            showFileImporter = true
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.bottom, 8)

                Divider().overlay(Color.mkBorder)

                // ── Catalog Refresh ────────────────────────────────────────
                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 8) {
                        Image(systemName: "arrow.clockwise.circle")
                            .foregroundColor(.mkAccent)
                        Text("Catalog Refresh")
                            .font(.subheadline.weight(.semibold))
                            .foregroundColor(.mkText)
                    }
                    Text("Re-fetch all streaming content from the API. Use this if your catalog looks out of date. It may take a few minutes.")
                        .font(.caption)
                        .foregroundColor(.mkMuted)
                        .fixedSize(horizontal: false, vertical: true)
                    MKButton(
                        label: isRefreshing ? "Starting…" : "Refresh Catalog",
                        icon: "arrow.clockwise.circle.fill",
                        isLoading: isRefreshing
                    ) {
                        showRefreshConfirm = true
                    }
                    .disabled(app.selectedPlatforms.isEmpty)
                    if app.selectedPlatforms.isEmpty {
                        Text("Add streaming services first.")
                            .font(.caption).foregroundColor(.mkMuted)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.bottom, 24)
            }
            .padding(.horizontal, 16).padding(.top, 12)
            } // end else
        }
        .task { await loadAccount() }
        .onChange(of: avatarItem) { _, item in
            Task { await loadAvatar(from: item) }
        }
        .fileImporter(
            isPresented: $showFileImporter,
            allowedContentTypes: [.commaSeparatedText, .plainText, .data],
            allowsMultipleSelection: false
        ) { result in
            guard let url = try? result.get().first else { return }
            Task { await handleLetterboxdFile(url: url) }
        }
        .alert(
            lbxImportType == "watched"
                ? "Import \(lbxItems.count) Watched Movies?"
                : "Import \(lbxItems.count) Watchlist Movies?",
            isPresented: $showLbxConfirm
        ) {
            Button("Import") { Task { await runLetterboxdImport() } }
            Button("Cancel", role: .cancel) { }
        } message: {
            Text(lbxImportType == "watched"
                ? "These will be added to your watched history."
                : "These will be saved to your watchlist.")
        }
        .alert("CSV Type Mismatch", isPresented: $showLbxMismatch) {
            Button("Import as \(lbxImportType == "watched" ? "Watched" : "Watchlist")") { showLbxConfirm = true }
            Button("Cancel", role: .cancel) { lbxItems = [] }
        } message: {
            Text("This file looks like a \(lbxImportType == "watched" ? "watchlist" : "watched history") CSV. Are you sure you want to import it as \(lbxImportType == "watched" ? "watched movies" : "your watchlist")?")
        }
        .alert("Refresh Catalog?", isPresented: $showRefreshConfirm) {
            Button("Refresh", role: .destructive) { Task { await refreshCatalog() } }
            Button("Cancel", role: .cancel) { }
        } message: {
            Text("This will re-fetch all streaming content from the API. It may take a few minutes.")
        }
    }

    @MainActor func handleLetterboxdFile(url: URL) async {
        lbxImportDone = nil
        lbxImportProgress = "Reading file…"
        let accessed = url.startAccessingSecurityScopedResource()
        defer { if accessed { url.stopAccessingSecurityScopedResource() } }
        guard let text = try? String(contentsOf: url, encoding: .utf8) else {
            lbxImportProgress = nil
            lbxImportDone = "⚠ Could not read file"
            return
        }
        lbxImportProgress = "Parsing CSV…"
        do {
            let resp: LetterboxdPreviewResult = try await APIService.shared.post(
                "/import/letterboxd/preview",
                body: ["csvText": text, "fileName": url.lastPathComponent],
                token: app.token
            )
            let detectedType = resp.importType ?? "watched"
            lbxImportType = lbxIntendedType  // always use the button the user pressed
            lbxItems = resp.items.map { item in ["name": item.name, "year": item.year] }
            lbxImportProgress = nil
            if lbxItems.isEmpty {
                lbxImportDone = "No valid rows found in CSV"
            } else if detectedType != lbxIntendedType {
                showLbxMismatch = true  // warn before confirming
            } else {
                showLbxConfirm = true
            }
        } catch {
            lbxImportProgress = nil
            lbxImportDone = "⚠ \((error as? APIError)?.errorDescription ?? "Preview failed")"
        }
    }

    @MainActor func runLetterboxdImport() async {
        // Matches MAX_IMPORT_BATCH on the server.
        let batchSize = 100
        var offset = 0
        var totalMatched = 0
        var totalNotFound = 0

        while offset < lbxItems.count {
            let chunk = Array(lbxItems[offset..<min(offset + batchSize, lbxItems.count)])
            lbxImportProgress = "Importing \(offset + chunk.count) of \(lbxItems.count)…"

            let encodableChunk: [[String: Any]] = chunk.compactMap { item in
                guard let name = item["name"] as? String, let year = item["year"] as? Int else { return nil }
                return ["name": name, "year": year]
            }

            do {
                // A watchlist upload supersedes the saved list, so the first
                // batch clears it and the rest append. A watched upload is a
                // history and only ever merges, so it never sets this.
                var body: [String: Any] = ["items": encodableChunk, "importType": lbxImportType]
                if lbxImportType == "watchlist" && offset == 0 {
                    body["replaceExisting"] = true
                }
                let resp: LetterboxdImportResponse = try await APIService.shared.post(
                    "/import/letterboxd",
                    body: body,
                    token: app.token
                )
                totalMatched  += resp.matched ?? 0
                totalNotFound += resp.notFound ?? 0
            } catch { break }

            offset += batchSize
        }

        // Update local watchlist IDs so filter chip appears immediately
        if lbxImportType == "watchlist" {
            // Reload watchlist IDs by fetching from server
            if let resp = try? await APIService.shared.get("/watchlist", token: app.token) as WatchlistResponse {
                for item in resp.items ?? [] { app.setWatchlisted(item.itemId, on: true) }
            }
        } else {
            // Reload watched IDs
            if let resp = try? await APIService.shared.get("/watched", token: app.token) as WatchedListResponse {
                for item in resp.items ?? [] { app.setWatched(item.itemId, watched: true) }
            }
        }

        lbxImportProgress = nil
        lbxImportDone = "✓ Imported \(totalMatched) of \(lbxItems.count) movies\(totalNotFound > 0 ? " (\(totalNotFound) not found)" : "")"
        lbxItems = []
    }

    var avatarSection: some View {
        VStack(spacing: 10) {
            ZStack {
                if let img = avatarUIImage {
                    Image(uiImage: img).resizable().scaledToFill()
                } else {
                    Image(systemName: "person.circle.fill")
                        .resizable().foregroundColor(.mkMuted.opacity(0.5))
                }
            }
            .frame(width: 88, height: 88)
            .clipShape(Circle())
            .overlay(Circle().stroke(Color.mkAccent.opacity(0.4), lineWidth: 2))
            PhotosPicker(selection: $avatarItem, matching: .images) {
                Label("Change Photo", systemImage: "camera.fill")
                    .font(.footnote.weight(.semibold))
                    .foregroundColor(.mkAccent)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 8)
    }

    @MainActor func loadAccount() async {
        isLoadingAccount = true
        do {
            let info: AccountInfo = try await APIService.shared.get("/account", token: app.token)
            username = info.username ?? ""
            email = info.email ?? ""
            if let pic = info.profilePic, pic.hasPrefix("data:image/"),
               let data = Data(base64Encoded: pic.components(separatedBy: ",").last ?? ""),
               let img = UIImage(data: data) {
                avatarUIImage = img
            }
        } catch {
            // Worth saying: without it the profile tab shows empty fields and
            // looks like an account with nothing in it.
            app.report(error: error, whileTrying: "Loading your profile")
        }
        isLoadingAccount = false
    }

    @MainActor func loadAvatar(from item: PhotosPickerItem?) async {
        guard let item else { return }
        guard let data = try? await item.loadTransferable(type: Data.self),
              let srcImg = UIImage(data: data) else { return }
        let size = CGSize(width: 256, height: 256)
        let renderer = UIGraphicsImageRenderer(size: size)
        let resized = renderer.image { _ in srcImg.draw(in: CGRect(origin: .zero, size: size)) }
        avatarUIImage = resized
        if let jpegData = resized.jpegData(compressionQuality: 0.8) {
            profilePicBase64 = "data:image/jpeg;base64," + jpegData.base64EncodedString()
        }
    }

    @MainActor func saveProfile() async {
        isSaving = true; message = ""; messageIsError = false
        var body: [String: String] = [:]
        let trimUser = username.trimmingCharacters(in: .whitespaces)
        let trimEmail = email.trimmingCharacters(in: .whitespaces)
        if !trimUser.isEmpty  { body["username"] = trimUser }
        if !trimEmail.isEmpty { body["email"] = trimEmail }
        if !newPassword.isEmpty {
            if currentPassword.isEmpty {
                message = "Enter your current password to change it"; messageIsError = true
                isSaving = false; return
            }
            body["currentPassword"] = currentPassword
            body["newPassword"] = newPassword
        }
        if let pic = profilePicBase64 { body["profilePic"] = pic }
        do {
            let resp: UpdateAccountResponse = try await APIService.shared.put("/account", body: body, token: app.token)
            if let newToken = resp.token { app.updateToken(newToken) }
            if let newUser = body["username"] { app.updateUsername(newUser) }
            message = "Saved ✓"; messageIsError = false
            currentPassword = ""; newPassword = ""
        } catch {
            message = (error as? APIError)?.errorDescription ?? "Update failed"
            messageIsError = true
        }
        isSaving = false
    }

    /// Kick off a catalog rebuild.
    ///
    /// Reported through the app-wide banner rather than this screen's own
    /// message line. The job outlives the screen — it runs on the server for
    /// minutes — so someone who starts it and goes back to browsing would
    /// otherwise never learn whether it even began.
    @MainActor func refreshCatalog() async {
        isRefreshing = true
        defer { isRefreshing = false }
        do {
            let _: SimpleResponse = try await APIService.shared.post("/catalog/refresh", body: [:], token: app.token)
            app.report(success: "Catalog refresh started. It may take a few minutes.")
        } catch {
            app.report(error: error, whileTrying: "Catalog refresh")
        }
    }
}

// MARK: Watched Tab

struct WatchedOnlyTabView: View {
    @Environment(AppState.self) private var app
    @State private var items: [WatchedItem] = []
    @State private var isLoading = true
    @State private var isClearing = false
    @State private var confirmClear = false

    var body: some View {
        VStack(spacing: 0) {
            if !items.isEmpty {
                ClearListBar(
                    count: items.count,
                    label: "watched",
                    isClearing: isClearing,
                    action: { confirmClear = true }
                )
            }
            content
        }
        .confirmationDialog(
            "Clear your watched list?",
            isPresented: $confirmClear,
            titleVisibility: .visible
        ) {
            Button("Remove all \(items.count) titles", role: .destructive) {
                Task { await clearAll() }
            }
            Button("Cancel", role: .cancel) { }
        } message: {
            Text("This cannot be undone.")
        }
    }

    var content: some View {
        Group {
            if isLoading {
                VStack { Spacer(); ProgressView().tint(.mkAccent); Spacer() }
            } else if items.isEmpty {
                VStack(spacing: 12) {
                    Spacer()
                    // A decorative glyph standing in for a missing screenful, not copy — the
                    // sentence beside it is what carries the meaning and scales. Sized to hold
                    // the empty state together rather than to be read.
                    Image(systemName: "checkmark.circle").font(.system(size: 44)).foregroundColor(.mkMuted)
                    Text("Nothing watched yet").font(.title3).bold().foregroundColor(.mkMuted)
                    Text("Mark titles as watched from the catalog, or import your Letterboxd watched.csv in Profile.")
                        .font(.subheadline).foregroundColor(.mkMuted.opacity(0.7))
                        .multilineTextAlignment(.center).padding(.horizontal, 40)
                    Spacer()
                }
            } else {
                List {
                    ForEach(items) { item in
                        watchRow(item.itemId, title: item.title, mediaType: item.mediaType)
                    }
                    .onDelete { offsets in Task { await removeItem(at: offsets) } }
                }
                .listStyle(.plain)
                .background(Color.mkBackground)
            }
        }
        .task { await load() }
    }

    @MainActor func clearAll() async {
        isClearing = true
        // Optimistic: the list empties immediately and is reloaded from the
        // server if the call fails, so a slow network never looks like a no-op.
        let previous = items
        items = []
        do {
            let _: ToggleWatchedResponse = try await APIService.shared.delete("/watched", token: app.token)
            app.replaceWatchedIds([])
        } catch let err as APIError {
            items = previous
            if case .unauthorized = err { app.logout() }
        } catch {
            items = previous
        }
        isClearing = false
    }

    @ViewBuilder
    func watchRow(_ itemId: String, title: String?, mediaType: String?) -> some View {
        HStack(spacing: 12) {
            Image(systemName: (mediaType ?? "movie") == "tv" ? "tv" : "film")
                .foregroundColor(.mkAccent).frame(width: 24)
            VStack(alignment: .leading, spacing: 2) {
                Text(title ?? "Unknown Title").font(.subheadline.weight(.semibold)).foregroundColor(.mkText)
                Text((mediaType ?? "movie") == "tv" ? "TV Show" : "Movie")
                    .font(.caption).foregroundColor(.mkMuted)
            }
            Spacer()
            Image(systemName: "checkmark.circle.fill").foregroundColor(.green)
        }
        .listRowBackground(Color.mkSurface)
    }

    @MainActor func load() async {
        isLoading = true
        if let resp: WatchedListResponse = try? await APIService.shared.get("/watched", token: app.token) {
            let loaded = resp.items ?? []
            items = loaded
            app.replaceWatchedIds(loaded.map { $0.itemId })
        }
        isLoading = false
    }

    @MainActor func removeItem(at offsets: IndexSet) async {
        for i in offsets {
            let item = items[i]
            _ = try? await APIService.shared.delete("/watched/\(item.itemId)", token: app.token) as ToggleWatchedResponse
            app.setWatched(item.itemId, watched: false)
        }
        items.remove(atOffsets: offsets)
    }
}

/// Header bar above a saved list, carrying the count and a destructive clear.
/// Solid, not glass: it sits in the content column, not the floating layer.
struct ClearListBar: View {
    let count: Int
    let label: String
    let isClearing: Bool
    let action: () -> Void

    var body: some View {
        HStack {
            Text("\(count) \(count == 1 ? "title" : "titles")")
                .font(.footnote.weight(.semibold))
                .foregroundColor(.mkMuted)
            Spacer()
            Button(action: action) {
                HStack(spacing: 6) {
                    if isClearing {
                        ProgressView().scaleEffect(0.7).tint(.red)
                    } else {
                        Image(systemName: "trash").font(.caption.weight(.semibold))
                    }
                    Text(isClearing ? "Clearing…" : "Clear all")
                        .font(.footnote.weight(.semibold))
                }
                .foregroundColor(.red)
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(Color.red.opacity(0.12), in: Capsule())
                .overlay(Capsule().stroke(Color.red.opacity(0.3), lineWidth: 1))
            }
            .buttonStyle(.plain)
            .disabled(isClearing)
            .accessibilityLabel("Clear entire \(label)")
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }
}

// MARK: Watchlist Tab

/// Currently Watching — the third list.
///
/// It differs from the other two lists in one way: each row carries a sentence
/// about the show's schedule, and a dot when something has aired since the user
/// last said they were caught up. Both come from the server, which composes the
/// copy once so this app and the web app never say different things about the
/// same show.
struct CurrentlyWatchingTabView: View {
    @Environment(AppState.self) private var app
    @State private var items: [CurrentlyWatchingItem] = []
    @State private var isLoading = true
    @State private var isClearing = false
    @State private var confirmClear = false
    @State private var newEpisodesOnly = false

    /// Filtered locally: the server already sorts new-first, and a round trip
    /// for a toggle the user may flip twice is not worth the latency.
    var visible: [CurrentlyWatchingItem] {
        newEpisodesOnly ? items.filter { $0.hasNewEpisode == true } : items
    }

    var newCount: Int { items.filter { $0.hasNewEpisode == true }.count }

    var body: some View {
        VStack(spacing: 0) {
            if !items.isEmpty {
                filterBar
                ClearListBar(
                    count: items.count,
                    label: "currently watching list",
                    isClearing: isClearing,
                    action: { confirmClear = true }
                )
            }
            content
        }
        .confirmationDialog(
            "Clear Currently Watching?",
            isPresented: $confirmClear,
            titleVisibility: .visible
        ) {
            Button("Remove all \(items.count) shows", role: .destructive) {
                Task { await clearAll() }
            }
            Button("Cancel", role: .cancel) { }
        } message: {
            Text("This cannot be undone.")
        }
    }

    var filterBar: some View {
        HStack {
            Button {
                withAnimation(.easeInOut(duration: 0.2)) { newEpisodesOnly.toggle() }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: newEpisodesOnly ? "largecircle.fill.circle" : "circle")
                        .font(.caption.weight(.semibold))
                    Text("New episodes only")
                        .font(.footnote.weight(.semibold))
                }
                .foregroundColor(newEpisodesOnly ? .orange : .mkMuted)
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(
                    (newEpisodesOnly ? Color.orange.opacity(0.14) : Color.mkSubtleFill),
                    in: Capsule()
                )
                .overlay(
                    Capsule().stroke(
                        newEpisodesOnly ? Color.orange.opacity(0.4) : Color.mkBorder,
                        lineWidth: 1
                    )
                )
            }
            .buttonStyle(.plain)
            Spacer()
            if newCount > 0 {
                Text("\(newCount) with new episodes")
                    .font(.caption.weight(.semibold))
                    .foregroundColor(.orange)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
    }

    var content: some View {
        Group {
            if isLoading {
                VStack { Spacer(); ProgressView().tint(.mkAccent); Spacer() }
            } else if items.isEmpty {
                emptyState(
                    icon: "play.tv",
                    title: "Nothing in progress",
                    detail: "Add a series from the catalog and this list will tell you what day new episodes land."
                )
            } else if visible.isEmpty {
                emptyState(
                    icon: "checkmark.circle",
                    title: "All caught up",
                    detail: "Nothing has aired since you last marked these shows as caught up."
                )
            } else {
                List {
                    ForEach(visible) { item in
                        showRow(item)
                    }
                    .onDelete { offsets in Task { await removeItem(at: offsets) } }
                }
                .listStyle(.plain)
                .background(Color.mkBackground)
            }
        }
        .task { await load() }
    }

    @ViewBuilder
    func emptyState(icon: String, title: String, detail: String) -> some View {
        VStack(spacing: 12) {
            Spacer()
            Image(systemName: icon).font(.system(size: 44)).foregroundColor(.mkMuted)
            Text(title).font(.title3).bold().foregroundColor(.mkMuted)
            Text(detail)
                .font(.subheadline).foregroundColor(.mkMuted.opacity(0.7))
                .multilineTextAlignment(.center).padding(.horizontal, 40)
            Spacer()
        }
    }

    @ViewBuilder
    func showRow(_ item: CurrentlyWatchingItem) -> some View {
        let isNew = item.hasNewEpisode == true
        HStack(spacing: 12) {
            Image(systemName: isNew ? "play.tv.fill" : "play.tv")
                .foregroundColor(isNew ? .orange : .mkAccent)
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 3) {
                Text(item.title ?? "Unknown Title")
                    .font(.subheadline.weight(.semibold))
                    .foregroundColor(.mkText)
                HStack(spacing: 5) {
                    if isNew {
                        Circle().fill(Color.orange).frame(width: 6, height: 6)
                    }
                    Text(item.scheduleMessage ?? "Schedule not loaded yet")
                        .font(.caption)
                        .foregroundColor(isNew ? .orange : .mkMuted)
                }
            }
            Spacer()
            if isNew {
                Button {
                    Task { await markCaughtUp(item) }
                } label: {
                    Text("Caught up")
                        .font(.caption.weight(.semibold))
                        .foregroundColor(.mkAccent)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(Color.mkAccent.opacity(0.12), in: Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Mark \(item.title ?? "show") caught up")
            }
        }
        .listRowBackground(Color.mkSurface)
    }

    @MainActor func load() async {
        isLoading = true
        if let resp: CurrentlyWatchingResponse = try? await APIService.shared.get(
            "/currently-watching", token: app.token
        ) {
            let loaded = resp.items ?? []
            items = loaded
            app.replaceCurrentlyWatchingIds(loaded.map { $0.itemId })
        }
        isLoading = false
    }

    @MainActor func markCaughtUp(_ item: CurrentlyWatchingItem) async {
        // Optimistic: the dot is the whole point of the row, so it should clear
        // the moment it is tapped rather than after a round trip.
        items = items.map { row in
            row.itemId == item.itemId ? row.markedCaughtUp() : row
        }
        do {
            let _: SimpleResponse = try await APIService.shared.post(
                "/currently-watching/\(item.itemId)/caught-up", body: [:], token: app.token
            )
        } catch {
            await load()
        }
    }

    @MainActor func clearAll() async {
        isClearing = true
        let previous = items
        items = []
        do {
            let _: ToggleWatchedResponse = try await APIService.shared.delete(
                "/currently-watching", token: app.token
            )
            app.replaceCurrentlyWatchingIds([])
        } catch let err as APIError {
            items = previous
            if case .unauthorized = err { app.logout() }
        } catch {
            items = previous
        }
        isClearing = false
    }

    @MainActor func removeItem(at offsets: IndexSet) async {
        // `visible` is what the list is showing, so offsets index into it, not
        // into `items` — with the filter on those are different arrays.
        let doomed = offsets.map { visible[$0] }
        for item in doomed {
            _ = try? await APIService.shared.delete(
                "/currently-watching/\(item.itemId)", token: app.token
            ) as SimpleResponse
            app.setCurrentlyWatching(item.itemId, on: false)
        }
        let removedIds = Set(doomed.map { $0.itemId })
        items.removeAll { removedIds.contains($0.itemId) }
    }
}

struct WatchlistOnlyTabView: View {
    @Environment(AppState.self) private var app
    @State private var items: [WatchlistItem] = []
    @State private var isLoading = true
    @State private var isClearing = false
    @State private var confirmClear = false

    var body: some View {
        VStack(spacing: 0) {
            if !items.isEmpty {
                ClearListBar(
                    count: items.count,
                    label: "watchlist",
                    isClearing: isClearing,
                    action: { confirmClear = true }
                )
            }
            content
        }
        .confirmationDialog(
            "Clear your watchlist?",
            isPresented: $confirmClear,
            titleVisibility: .visible
        ) {
            Button("Remove all \(items.count) titles", role: .destructive) {
                Task { await clearAll() }
            }
            Button("Cancel", role: .cancel) { }
        } message: {
            Text("This cannot be undone.")
        }
    }

    var content: some View {
        Group {
            if isLoading {
                VStack { Spacer(); ProgressView().tint(.mkAccent); Spacer() }
            } else if items.isEmpty {
                VStack(spacing: 12) {
                    Spacer()
                    Image(systemName: "bookmark.circle").font(.system(size: 44)).foregroundColor(.mkMuted)
                    Text("Watchlist is empty").font(.title3).bold().foregroundColor(.mkMuted)
                    Text("Import your Letterboxd watchlist.csv in Profile, or add titles from the catalog.")
                        .font(.subheadline).foregroundColor(.mkMuted.opacity(0.7))
                        .multilineTextAlignment(.center).padding(.horizontal, 40)
                    Spacer()
                }
            } else {
                List {
                    ForEach(items) { item in
                        watchRow(item.itemId, title: item.title, mediaType: item.mediaType)
                    }
                    .onDelete { offsets in Task { await removeItem(at: offsets) } }
                }
                .listStyle(.plain)
                .background(Color.mkBackground)
            }
        }
        .task { await load() }
    }

    @MainActor func clearAll() async {
        isClearing = true
        let previous = items
        items = []
        do {
            let _: ToggleWatchedResponse = try await APIService.shared.delete("/watchlist", token: app.token)
            app.replaceWatchlistIds([])
        } catch let err as APIError {
            items = previous
            if case .unauthorized = err { app.logout() }
        } catch {
            items = previous
        }
        isClearing = false
    }

    @ViewBuilder
    func watchRow(_ itemId: String, title: String?, mediaType: String?) -> some View {
        HStack(spacing: 12) {
            Image(systemName: (mediaType ?? "movie") == "tv" ? "tv" : "film")
                .foregroundColor(.mkAccent).frame(width: 24)
            VStack(alignment: .leading, spacing: 2) {
                Text(title ?? "Unknown Title").font(.subheadline.weight(.semibold)).foregroundColor(.mkText)
                Text((mediaType ?? "movie") == "tv" ? "TV Show" : "Movie")
                    .font(.caption).foregroundColor(.mkMuted)
            }
            Spacer()
            Image(systemName: "bookmark.fill").foregroundColor(.mkAccent)
        }
        .listRowBackground(Color.mkSurface)
    }

    @MainActor func load() async {
        isLoading = true
        if let resp: WatchlistResponse = try? await APIService.shared.get("/watchlist", token: app.token) {
            let loaded = resp.items ?? []
            items = loaded
            app.replaceWatchlistIds(loaded.map { $0.itemId })
        }
        isLoading = false
    }

    @MainActor func removeItem(at offsets: IndexSet) async {
        for i in offsets {
            let item = items[i]
            _ = try? await APIService.shared.delete("/watchlist/\(item.itemId)", token: app.token) as SimpleResponse
            app.setWatchlisted(item.itemId, on: false)
        }
        items.remove(atOffsets: offsets)
    }
}
