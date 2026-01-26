import SwiftUI

struct ChatUsageBar: View {
  let usage: ChatUsage?

  var body: some View {
    if let usage {
      HStack(spacing: 12) {
        UsagePill(label: "Prompt", value: usage.promptTokens)
        UsagePill(label: "Completion", value: usage.completionTokens)
        UsagePill(label: "Total", value: usage.totalTokens)
      }
      .padding(.horizontal, 16)
    }
  }
}

struct UsagePill: View {
  let label: String
  let value: Int

  var body: some View {
    VStack(spacing: 2) {
      Text(label).font(AppTheme.captionFont).foregroundColor(AppTheme.muted)
      Text("\(value)").font(AppTheme.monoFont)
    }
    .padding(.vertical, 6)
    .padding(.horizontal, 10)
    .background(AppTheme.card)
    .cornerRadius(10)
  }
}
