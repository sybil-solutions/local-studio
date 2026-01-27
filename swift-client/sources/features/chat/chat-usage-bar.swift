// CRITICAL
import SwiftUI

struct ChatUsageBar: View {
  let usage: ChatUsage?

  var body: some View {
    if let usage {
      HStack(spacing: 8) {
        UsagePill(label: "Input", value: usage.promptTokens, color: AppTheme.accentStrong)
        UsagePill(label: "Output", value: usage.completionTokens, color: AppTheme.success)
        UsagePill(label: "Total", value: usage.totalTokens, color: AppTheme.foreground)
      }
      .padding(.horizontal, 4)
    }
  }
}

struct UsagePill: View {
  let label: String
  let value: Int
  let color: Color

  var body: some View {
    HStack(spacing: 4) {
      Text(label)
        .font(AppTheme.captionFont)
        .foregroundColor(AppTheme.muted)
      Text("\(value)")
        .font(AppTheme.monoFont.weight(.medium))
        .foregroundColor(color)
    }
    .padding(.vertical, 6)
    .padding(.horizontal, 10)
    .background(AppTheme.card)
    .cornerRadius(8)
    .overlay(
      RoundedRectangle(cornerRadius: 8)
        .stroke(AppTheme.border, lineWidth: 1)
    )
  }
}
