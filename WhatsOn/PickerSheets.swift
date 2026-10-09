//
//  PickerSheets.swift
//  WhatsOn
//
// The genre and language pickers.
//

import SwiftUI

// MARK: - Genre Picker Sheet

struct GenrePickerSheet: View {
    @Binding var selected: Set<String>
    @Environment(\.dismiss) private var dismiss
    let onApply: () -> Void

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 10), count: 3)
    private let genreAccent = Color(red: 0.56, green: 0.38, blue: 1.0)

    var body: some View {
        NavigationView {
            ZStack {
                Color.mkBackground.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        Text("Select one or more genres. Results matching any selected genre will be shown.")
                            .font(.subheadline)
                            .foregroundColor(.mkMuted)
                            .padding(.horizontal, 20)
                            .padding(.top, 4)

                        GlassEffectContainer {
                            LazyVGrid(columns: columns, spacing: 10) {
                                ForEach(CatalogView.allGenres, id: \.key) { genre in
                                    let isOn = selected.contains(genre.key)
                                    Button {
                                        withAnimation(.spring(duration: 0.2)) {
                                            if isOn { selected.remove(genre.key) }
                                            else     { selected.insert(genre.key) }
                                        }
                                    } label: {
                                        Text(genre.label)
                                            .font(.footnote.weight(.semibold))
                                            .multilineTextAlignment(.center)
                                            .lineLimit(2)
                                            .minimumScaleFactor(0.8)
                                            .frame(maxWidth: .infinity, minHeight: 48)
                                            .foregroundColor(isOn ? .mkText : .mkMuted)
                                            .glassEffect(
                                                isOn
                                                    ? .regular.tint(genreAccent)
                                                    : .regular,
                                                in: RoundedRectangle(cornerRadius: 12, style: .continuous)
                                            )
                                    }
                                    .buttonStyle(ScaleButtonStyle())
                                }
                            }
                        }
                        .padding(.horizontal, 16)

                        if !selected.isEmpty {
                            Button(role: .destructive) {
                                selected.removeAll()
                            } label: {
                                Label("Clear All Genres", systemImage: "xmark.circle")
                                    .font(.subheadline)
                                    .foregroundColor(.mkAccent)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.top, 4)
                        }
                    }
                    .padding(.bottom, 24)
                }
            }
            .navigationTitle("Filter by Genre")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") { dismiss() }
                        .foregroundColor(.mkMuted)
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Apply") {
                        onApply()
                        dismiss()
                    }
                    .fontWeight(.semibold)
                    .foregroundColor(.mkAccent)
                }
            }
        }
        .themedSheet()
    }
}

// MARK: - Language Picker Sheet

struct LanguagePickerSheet: View {
    @Binding var selected: Set<String>
    let available: [String]   // languages the user has set up
    @Environment(\.dismiss) private var dismiss
    let onApply: () -> Void

    // Always show all supported languages so any language can be used as a filter,
    // regardless of which languages the user configured in their profile.
    var displayLanguages: [AppLanguage] { allLanguages }

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 10), count: 3)

    var body: some View {
        NavigationView {
            ZStack {
                Color.mkBackground.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        Text("Filter titles to show only selected languages.")
                            .font(.subheadline)
                            .foregroundColor(.mkMuted)
                            .padding(.horizontal, 20)
                            .padding(.top, 4)

                        GlassEffectContainer {
                            LazyVGrid(columns: columns, spacing: 10) {
                                ForEach(displayLanguages) { lang in
                                    let isOn = selected.contains(lang.key)
                                    Button {
                                        withAnimation(.spring(duration: 0.2)) {
                                            if isOn { selected.remove(lang.key) }
                                            else    { selected.insert(lang.key) }
                                        }
                                    } label: {
                                        Text(lang.label)
                                            .font(.footnote.weight(.semibold))
                                            .multilineTextAlignment(.center)
                                            .lineLimit(2).minimumScaleFactor(0.8)
                                            .frame(maxWidth: .infinity, minHeight: 48)
                                            .foregroundColor(isOn ? .mkText : .mkMuted)
                                            .glassEffect(
                                                isOn
                                                    ? .regular.tint(.mkAccent)
                                                    : .regular,
                                                in: RoundedRectangle(cornerRadius: 12, style: .continuous)
                                            )
                                    }
                                    .buttonStyle(ScaleButtonStyle())
                                }
                            }
                        }
                        .padding(.horizontal, 16)

                        if !selected.isEmpty {
                            Button(role: .destructive) {
                                selected.removeAll()
                            } label: {
                                Label("Clear Language Filter", systemImage: "xmark.circle")
                                    .font(.subheadline)
                                    .foregroundColor(.mkAccent)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.top, 4)
                        }
                    }
                    .padding(.bottom, 24)
                }
            }
            .navigationTitle("Filter by Language")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") { dismiss() }
                        .foregroundColor(.mkMuted)
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Apply") {
                        onApply()
                        dismiss()
                    }
                    .fontWeight(.semibold)
                    .foregroundColor(.mkAccent)
                }
            }
        }
        .themedSheet()
    }
}

// MARK: - Service Filter Sheet

/// Narrow the catalog to some of the services you picked.
///
/// The services tile in Settings decides what the catalog *covers*; this decides
/// what it *shows*. They were the same thing for a long time, and the gap it
/// left was most obvious with VOD: ticking it widened the pool to everything
/// rentable, mixed in with everything a subscription already covered, and with
/// nothing to narrow by — so on a popularity sort the rentable titles sat below
/// a page of subscription hits and read as absent.
///
/// An empty selection means every service, which is the behaviour this replaces.
struct ServiceFilterSheet: View {
    /// The services the reader subscribes to, in picker order.
    let available: [String]
    @Binding var selected: Set<String>
    @Environment(\.dismiss) private var dismiss
    let onApply: () -> Void

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 10), count: 2)

    private var platforms: [StreamingPlatform] {
        // Ordered by the picker rather than by the stored array, so VOD stays
        // last here too — it is the one entry that is not a subscription.
        allPlatforms.filter { available.contains($0.key) }
    }

    private var summary: String {
        if selected.isEmpty { return "Showing every service you picked." }
        if selected == [vodPlatformKey] { return "Showing only what you can rent or buy." }
        let n = selected.count
        return "Showing \(n) of your \(platforms.count) service\(platforms.count == 1 ? "" : "s")."
    }

    var body: some View {
        NavigationView {
            ZStack {
                Color.mkBackground.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        Text(summary)
                            .font(.subheadline).foregroundColor(.mkMuted)
                            .padding(.horizontal, 20).padding(.top, 4)

                        GlassEffectContainer {
                            LazyVGrid(columns: columns, spacing: 10) {
                                ForEach(platforms) { platform in
                                    let isOn = selected.contains(platform.key)
                                    Button {
                                        withAnimation(.spring(duration: 0.2)) {
                                            if isOn { selected.remove(platform.key) }
                                            else    { selected.insert(platform.key) }
                                        }
                                    } label: {
                                        HStack(spacing: 7) {
                                            ProviderMark(name: platform.name, size: 18)
                                                .accessibilityHidden(true)
                                            Text(platform.key == vodPlatformKey ? "Rent or Buy" : platform.name)
                                                .font(.footnote.weight(.semibold))
                                                .lineLimit(2).minimumScaleFactor(0.8)
                                                .multilineTextAlignment(.leading)
                                            Spacer(minLength: 0)
                                        }
                                        .padding(.horizontal, 10)
                                        .frame(maxWidth: .infinity, minHeight: 50)
                                        .foregroundColor(isOn ? .mkText : .mkMuted)
                                        .glassEffect(
                                            isOn ? .regular.tint(platform.accentColor) : .regular,
                                            in: RoundedRectangle(cornerRadius: 12, style: .continuous)
                                        )
                                    }
                                    .buttonStyle(ScaleButtonStyle())
                                    .accessibilityLabel(
                                        platform.key == vodPlatformKey ? "Rent or buy" : platform.name
                                    )
                                    .accessibilityAddTraits(isOn ? .isSelected : [])
                                }
                            }
                        }
                        .padding(.horizontal, 16)

                        if !selected.isEmpty {
                            Button(role: .destructive) {
                                selected.removeAll()
                            } label: {
                                Label("Show All Services", systemImage: "xmark.circle")
                                    .font(.subheadline).foregroundColor(.mkAccent)
                            }
                            .frame(maxWidth: .infinity).padding(.top, 4)
                        }
                    }
                    .padding(.bottom, 24)
                }
            }
            .navigationTitle("Filter by Service")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") { dismiss() }.foregroundColor(.mkMuted)
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Apply") {
                        onApply()
                        dismiss()
                    }
                    .fontWeight(.semibold).foregroundColor(.mkAccent)
                }
            }
        }
        .themedSheet()
    }
}
