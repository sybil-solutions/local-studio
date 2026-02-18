// CRITICAL
import SwiftUI

struct DiscoverFiltersView: View {
  @Binding var search: String
  @Binding var task: String
  @Binding var sort: String
  @Binding var excludedQuantizations: Set<String>
  let onRefresh: () -> Void
  private let quantTags = ["AWQ", "GPTQ", "GGUF", "EXL2", "FP8", "FP16", "BF16", "INT8", "INT4", "W4A16", "W8A16"]

  var body: some View {
    CardView {
      VStack(spacing: 12) {
        HStack(spacing: 12) {
          Image(systemName: "magnifyingglass")
            .font(.system(size: 14, weight: .semibold))
            .foregroundColor(AppTheme.muted)
          TextField("Search models", text: $search)
            .textFieldStyle(.plain)
            .foregroundColor(AppTheme.foreground)
            #if canImport(UIKit)
            .textInputAutocapitalization(.never)
            #endif
            .autocorrectionDisabled()
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(AppTheme.cardHover)
        .cornerRadius(12)

        HStack(spacing: 12) {
          TextField("Task (e.g. text-generation)", text: $task)
            .textFieldStyle(.plain)
            .foregroundColor(AppTheme.foreground)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(AppTheme.cardHover)
            .cornerRadius(10)
            #if canImport(UIKit)
            .textInputAutocapitalization(.never)
            #endif
            .autocorrectionDisabled()

          Picker("Sort", selection: $sort) {
            Text("Trending").tag("trending")
            Text("Downloads").tag("downloads")
            Text("Likes").tag("likes")
            Text("Modified").tag("modified")
          }
          .pickerStyle(.menu)
          .tint(AppTheme.foreground)

          Menu {
            ForEach(quantTags, id: \.self) { q in
              Button(action: { toggleQuant(q) }) {
                Label(q, systemImage: excludedQuantizations.contains(q) ? "checkmark.circle.fill" : "circle")
              }
            }
            Divider()
            Button("Clear") { excludedQuantizations.removeAll() }
          } label: {
            Text(excludedQuantizations.isEmpty ? "Hide quants" : "Hidden: \(excludedQuantizations.count)")
              .font(AppTheme.captionFont)
              .foregroundColor(AppTheme.foreground)
              .padding(.horizontal, 12)
              .padding(.vertical, 8)
              .background(AppTheme.cardHover)
              .cornerRadius(10)
          }
          .buttonStyle(.plain)

          Button(action: onRefresh) {
            Image(systemName: "arrow.clockwise")
              .font(.system(size: 13, weight: .semibold))
              .foregroundColor(AppTheme.foreground)
              .frame(width: 36, height: 32)
              .background(AppTheme.accentStrong)
              .cornerRadius(10)
          }
          .buttonStyle(.plain)
          .accessibilityLabel("Refresh")
        }
      }
    }
  }

  private func toggleQuant(_ quant: String) {
    if excludedQuantizations.contains(quant) { excludedQuantizations.remove(quant) }
    else { excludedQuantizations.insert(quant) }
  }
}
