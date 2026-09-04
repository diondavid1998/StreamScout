//
//  FormControls.swift
//  WhatsOn
//
// Fields, buttons and the range slider.
//

import SwiftUI

// MARK: - Form Controls

struct MKTextField: View {
    let placeholder: String
    @Binding var text: String
    let icon: String
    var isSecure: Bool = false
    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.subheadline)
                .foregroundColor(focused ? .mkAccent : .mkMuted)
                .frame(width: 20)
            if isSecure {
                SecureField(placeholder, text: $text).focused($focused)
            } else {
                TextField(placeholder, text: $text)
                    .disableAutocap().autocorrectionDisabled().focused($focused)
            }
        }
        .foregroundColor(.mkText)
        .padding(.horizontal, 16).padding(.vertical, 14)
        .background(Color.mkBackground)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(focused ? Color.mkAccent.opacity(0.6) : Color.mkBorder, lineWidth: 1.5)
        )
    }
}

struct MKButton: View {
    let label: String
    let icon: String
    var isLoading: Bool = false
    var isDisabled: Bool = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if isLoading { ProgressView().tint(.mkOnAccent).scaleEffect(0.85) }
                else { Image(systemName: icon).font(.subheadline) }
                Text(label)
                    .font(.callout.weight(.semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)
            }
            .padding(.vertical, 15)
        }
        .disabled(isLoading || isDisabled)
        .tint(.mkAccent)
        .buttonStyle(.glassProminent)
        .frame(maxWidth: .infinity)
    }
}

struct IconButton: View {
    let icon: String
    var spinning: Bool = false
    let action: () -> Void
    @State private var angle: Double = 0
    var body: some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.body)
                .foregroundColor(.mkMuted)
                .rotationEffect(.degrees(angle))
                .frame(width: 36, height: 36)
                .glassEffect(.regular, in: Circle())
                .contentShape(Circle())
        }
        .buttonStyle(ScaleButtonStyle())
        .onAppear {
            if spinning {
                withAnimation(.linear(duration: 1).repeatForever(autoreverses: false)) {
                    angle = 360
                }
            }
        }
        .onChange(of: spinning) { _, nowSpinning in
            if nowSpinning {
                angle = 0
                withAnimation(.linear(duration: 1).repeatForever(autoreverses: false)) {
                    angle = 360
                }
            } else {
                withAnimation(.default) { angle = 0 }
            }
        }
    }
}

struct ScaleButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.95 : 1.0)
            .animation(.spring(duration: 0.18), value: configuration.isPressed)
    }
}

// MARK: - Range Slider

struct RangeSlider: View {
    @Binding var low: Double
    @Binding var high: Double
    let bounds: ClosedRange<Double>
    let step: Double

    private let thumbDiameter: CGFloat = 26

    var body: some View {
        GeometryReader { geo in
            let trackWidth = geo.size.width - thumbDiameter
            let lowOffset  = CGFloat((low  - bounds.lowerBound) / (bounds.upperBound - bounds.lowerBound)) * trackWidth
            let highOffset = CGFloat((high - bounds.lowerBound) / (bounds.upperBound - bounds.lowerBound)) * trackWidth

            ZStack(alignment: .leading) {
                // Background track
                Capsule()
                    .fill(Color.mkBorder)
                    .frame(height: 4)
                    .padding(.horizontal, thumbDiameter / 2)

                // Active range fill
                Capsule()
                    .fill(Color.mkAccent)
                    .frame(width: max(0, highOffset - lowOffset), height: 4)
                    .padding(.leading, thumbDiameter / 2 + lowOffset)

                // Low thumb
                Circle()
                    .fill(Color.mkAccent)
                    .frame(width: thumbDiameter, height: thumbDiameter)
                    .shadow(color: Color.mkAccent.opacity(0.4), radius: 5)
                    .offset(x: lowOffset)
                    .gesture(
                        DragGesture(minimumDistance: 0, coordinateSpace: .named("rangeTrack"))
                            .onChanged { drag in
                                let val = snapValue(x: drag.location.x, trackWidth: trackWidth)
                                low = min(max(val, bounds.lowerBound), high - step)
                            }
                    )
                    .zIndex(lowOffset >= highOffset - 1 ? 1 : 0)

                // High thumb
                Circle()
                    .fill(Color.mkAccent)
                    .frame(width: thumbDiameter, height: thumbDiameter)
                    .shadow(color: Color.mkAccent.opacity(0.4), radius: 5)
                    .offset(x: highOffset)
                    .gesture(
                        DragGesture(minimumDistance: 0, coordinateSpace: .named("rangeTrack"))
                            .onChanged { drag in
                                let val = snapValue(x: drag.location.x, trackWidth: trackWidth)
                                high = max(min(val, bounds.upperBound), low + step)
                            }
                    )
            }
            .coordinateSpace(name: "rangeTrack")
        }
        .frame(height: thumbDiameter)
    }

    private func snapValue(x: CGFloat, trackWidth: CGFloat) -> Double {
        let pct = Double(max(0, min(x - thumbDiameter / 2, trackWidth)) / trackWidth)
        let raw = bounds.lowerBound + pct * (bounds.upperBound - bounds.lowerBound)
        return (raw / step).rounded() * step
    }
}
