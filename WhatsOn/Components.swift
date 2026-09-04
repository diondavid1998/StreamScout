//
//  Components.swift
//  WhatsOn
//
// Small pieces used across several screens: chips, marks, the flow layout and
// the score strip.
//

import SwiftUI

// MARK: - Reusable Components

struct FilterChip: View {
    let label: String
    let icon: String
    let active: Bool
    /// Menus get a chevron; toggles do not — the old chip drew one either way,
    /// promising a picker that never opened.
    var showsChevron: Bool = true

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: icon).font(.caption2.weight(.semibold))
            Text(label).font(.footnote.weight(active ? .semibold : .medium))
            if showsChevron {
                Image(systemName: "chevron.down").font(.caption2.weight(.bold))
            }
        }
        .foregroundColor(active ? .mkOnAccent : Color.mkText.opacity(0.78))
        .padding(.horizontal, 13).padding(.vertical, 8)
        .background(active ? Color.mkAccent : Color.clear, in: Capsule())
        .contentShape(Capsule())
    }
}

// Genre chips — distinct purple tint so they stand out from provider chips
struct PillChip: View {
    let text: String; let color: Color
    var body: some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .kerning(0.2)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(color.opacity(0.13))
            .foregroundColor(color)
            .clipShape(Capsule())
            .overlay(Capsule().stroke(color.opacity(0.25), lineWidth: 1))
    }
}

// Streaming provider chips — neutral pill, clearly a "service" tag
/// A service's logo alone, sized to sit on a poster. Falls back to the monogram
/// for the services with no bundled artwork.
struct ProviderMark: View {
    let name: String
    var size: CGFloat = 13

    var platform: StreamingPlatform? {
        let lowered = name.lowercased()
        // Exact name first: with 31 services in the list, a substring match can
        // land on the wrong one (TMDB returns variants like "Netflix with Ads").
        return allPlatforms.first { $0.name.lowercased() == lowered }
            ?? allPlatforms.first { lowered.contains($0.key) }
    }

    var body: some View {
        Group {
            if let p = platform, let asset = p.logoAsset {
                Image(asset).resizable().scaledToFit()
            } else if let p = platform {
                RoundedRectangle(cornerRadius: 3, style: .continuous)
                    .fill(p.accentColor.opacity(0.9))
                    .overlay(
                        Text(p.monogram)
                            .font(.system(size: size * 0.5, weight: .bold, design: .rounded))
                            .foregroundColor(p.onAccentColor)
                            .minimumScaleFactor(0.5)
                            .lineLimit(1)
                    )
            } else {
                RoundedRectangle(cornerRadius: 3, style: .continuous)
                    .fill(Color.mkPlaceholderFill)
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: 3, style: .continuous))
        .accessibilityLabel(name)
    }
}

/// Wraps children onto as many lines as they need, at a fixed spacing.
///
/// Genre and service chips are variable-width and unbounded in count; an HStack
/// pushed them off the edge and a horizontal ScrollView hid them behind a swipe
/// nobody makes on a detail screen.
struct FlowRow: Layout {
    var spacing: CGFloat = 6

    /// Size a child against the width actually available, never against infinity.
    ///
    /// Asking with `.unspecified` let a long service or genre name report its full
    /// single-line width. One such chip was then wider than the row, and this
    /// layout reported that width as its own — pushing its container past the
    /// screen edge. `sizeThatFits` and `placeSubviews` have to measure children
    /// identically or placement drifts from the reported size, so both go through
    /// here.
    private func childSize(_ subview: LayoutSubview, available: CGFloat) -> CGSize {
        let proposal = available.isFinite
            ? ProposedViewSize(width: available, height: nil)
            : ProposedViewSize.unspecified
        var size = subview.sizeThatFits(proposal)
        size.width = min(size.width, available)
        return size
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var rowWidth: CGFloat = 0
        var rowHeight: CGFloat = 0
        var totalHeight: CGFloat = 0
        var widestRow: CGFloat = 0

        for subview in subviews {
            let size = childSize(subview, available: maxWidth)
            if rowWidth > 0 && rowWidth + spacing + size.width > maxWidth {
                widestRow = max(widestRow, rowWidth)
                totalHeight += rowHeight + spacing
                rowWidth = size.width
                rowHeight = size.height
            } else {
                rowWidth += rowWidth > 0 ? spacing + size.width : size.width
                rowHeight = max(rowHeight, size.height)
            }
        }
        totalHeight += rowHeight
        widestRow = max(widestRow, rowWidth)

        // Report the proposed width when there is one, so the layout fills its
        // column; otherwise the widest row, which by construction is the least
        // width that holds the content.
        return CGSize(width: maxWidth.isFinite ? maxWidth : widestRow, height: totalHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var rowHeight: CGFloat = 0

        for subview in subviews {
            let size = childSize(subview, available: bounds.width)
            if x > bounds.minX && x + size.width > bounds.maxX {
                x = bounds.minX
                y += rowHeight + spacing
                rowHeight = 0
            }
            subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}

/// Separator between items on a meta line.
struct MetaDot: View {
    var body: some View {
        Circle()
            .fill(Color.mkMuted.opacity(0.5))
            .frame(width: 3, height: 3)
    }
}

/// Every score on one shared surface, divided rather than boxed.
///
/// Replaces a row of individually-bordered chips, each with its own outline, that
/// read as four unrelated badges. One surface with rules between the scores makes
/// them comparable at a glance.
///
/// Cells size to their own content and the row scrolls horizontally. Splitting the
/// card's width into equal slots left roughly 30pt per score, so "100%" and "8.4"
/// were scaled down and then truncated mid-number once a title had all four.
struct ScoreStrip: View {
    let entries: [MovieCardView.RatingEntry]
    var compact: Bool = true

    @ViewBuilder
    var body: some View {
        if entries.isEmpty {
            EmptyView()
        } else {
            ScrollView(.horizontal) {
                HStack(spacing: 0) {
                    ForEach(entries.indices, id: \.self) { index in
                        scoreCell(entries[index])
                            .overlay(alignment: .leading) { rule(index > 0) }
                    }
                    // Ratings arrive from OMDB after the catalog does. Say so rather
                    // than leaving a lone TMDb score looking like the whole answer.
                    if entries.count == 1 && entries[0].label == "TMDb" {
                        Text("Scoring…")
                            .font(.caption2.weight(.semibold))
                            .foregroundColor(.mkMuted)
                            .padding(.horizontal, 9)
                            .padding(.vertical, compact ? 6 : 12)
                            .overlay(alignment: .leading) { rule(true) }
                    }
                }
            }
            .scrollIndicators(.hidden)
            // Nothing to scroll when every score already fits, so don't rubber-band.
            .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.mkSubtleFill)
            .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .stroke(Color.mkHairline, lineWidth: 1)
            )
        }
    }

    /// Drawn as an overlay on the cell's leading edge rather than as a sibling in
    /// the stack: a bare `Rectangle` between content-sized cells has no ideal
    /// height to adopt inside a scroll view, and collapses to 10pt.
    @ViewBuilder
    func rule(_ visible: Bool) -> some View {
        if visible {
            Rectangle().fill(Color.mkHairline).frame(width: 1)
        }
    }

    @ViewBuilder
    func scoreCell(_ entry: MovieCardView.RatingEntry) -> some View {
        if compact {
            HStack(spacing: 5) {
                scoreMark(entry)
                Text(entry.value)
                    .font(.caption.weight(.bold))
                    .foregroundColor(.mkText)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .padding(.horizontal, 11)
            .padding(.vertical, 6)
            .fixedSize(horizontal: true, vertical: false)
        } else {
            VStack(spacing: 6) {
                scoreMark(entry, size: 18)
                Text(entry.value)
                    .font(.body.weight(.bold))
                    .foregroundColor(.mkText)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                Text(entry.label.uppercased())
                    .font(.caption2.weight(.semibold))
                    .kerning(0.6)
                    .foregroundColor(.mkMuted)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .frame(minWidth: 74)
            .fixedSize(horizontal: true, vertical: false)
        }
    }

    @ViewBuilder
    func scoreMark(_ entry: MovieCardView.RatingEntry, size: CGFloat = 13) -> some View {
        if let asset = entry.logoAsset {
            Image(asset).resizable().scaledToFit()
                .frame(width: size, height: size)
                .clipShape(RoundedRectangle(cornerRadius: 3, style: .continuous))
        } else {
            Circle().fill(entry.color).frame(width: size * 0.55, height: size * 0.55)
        }
    }
}
