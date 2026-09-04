//
//  YearFilterSheet.swift
//  WhatsOn
//
// Narrowing the feed by release year.
//

import SwiftUI

// MARK: - Year Filter Sheet

struct YearFilterSheet: View {
    @Binding var yearMin: String
    @Binding var yearMax: String
    @Environment(\.dismiss) private var dismiss
    let onApply: () -> Void

    private let minYear: Double = 1950
    private let maxYear: Double = Double(Calendar.current.component(.year, from: Date()))

    @State private var sliderMin: Double = 1950
    @State private var sliderMax: Double = Double(Calendar.current.component(.year, from: Date()))

    var body: some View {
        NavigationView {
            ZStack {
                Color.mkBackground.ignoresSafeArea()
                VStack(spacing: 32) {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("From").font(.caption).foregroundColor(.mkMuted)
                            Text(String(Int(sliderMin)))
                                .font(.system(.title, design: .rounded).weight(.bold))
                                .foregroundColor(.mkAccent)
                        }
                        Spacer()
                        Image(systemName: "arrow.left.arrow.right")
                            .font(.footnote).foregroundColor(.mkMuted)
                        Spacer()
                        VStack(alignment: .trailing, spacing: 2) {
                            Text("To").font(.caption).foregroundColor(.mkMuted)
                            Text(String(Int(sliderMax)))
                                .font(.system(.title, design: .rounded).weight(.bold))
                                .foregroundColor(.mkAccent)
                        }
                    }
                    .padding(.horizontal, 24)
                    .padding(.top, 16)

                    RangeSlider(low: $sliderMin, high: $sliderMax, bounds: minYear...maxYear, step: 1)
                        .padding(.horizontal, 24)

                    Button {
                        sliderMin = minYear; sliderMax = maxYear
                        yearMin = ""; yearMax = ""
                    } label: {
                        Label("Reset to All Years", systemImage: "arrow.counterclockwise")
                            .font(.subheadline).foregroundColor(.mkAccent)
                    }

                    Spacer()
                }
            }
            .navigationTitle("Filter by Year")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") { dismiss() }.foregroundColor(.mkMuted)
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Apply") {
                        yearMin = sliderMin > minYear ? String(Int(sliderMin)) : ""
                        yearMax = sliderMax < maxYear ? String(Int(sliderMax)) : ""
                        onApply(); dismiss()
                    }
                    .fontWeight(.semibold).foregroundColor(.mkAccent)
                }
            }
            .onAppear {
                sliderMin = Double(yearMin) ?? minYear
                sliderMax = Double(yearMax) ?? maxYear
            }
        }
    }
}
