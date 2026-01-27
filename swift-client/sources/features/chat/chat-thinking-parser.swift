import Foundation

struct ThinkingResult {
  let thinking: String?
  let main: String
}

enum ThinkingParser {
  private static let openTags = ["<think>", "<thinking>", "<analysis>"]
  private static let closeTags = ["</think>", "</thinking>", "</analysis>"]
  private static let regex = try? NSRegularExpression(
    pattern: "<(think|thinking|analysis)>[\\s\\S]*?</(think|thinking|analysis)>",
    options: [.caseInsensitive]
  )

  static func parse(_ input: String) -> ThinkingResult {
    let lower = input.lowercased()
    guard let open = openTags.first(where: { lower.contains($0) }) else {
      return ThinkingResult(thinking: nil, main: input)
    }
    let parts = input.components(separatedBy: open)
    guard parts.count > 1 else { return ThinkingResult(thinking: nil, main: input) }
    let afterOpen = parts.dropFirst().joined()
    let closeTag = closeTags.first(where: { afterOpen.lowercased().contains($0) })
    if let closeTag {
      let chunks = afterOpen.components(separatedBy: closeTag)
      let thinking = chunks.first ?? ""
      let main = parts.first! + chunks.dropFirst().joined()
      return ThinkingResult(thinking: thinking.trimmingCharacters(in: .whitespacesAndNewlines), main: main)
    }
    return ThinkingResult(thinking: afterOpen.trimmingCharacters(in: .whitespacesAndNewlines), main: parts.first ?? "")
  }

  static func stripThinkingBlocks(_ input: String) -> String {
    guard let regex else { return input }
    let range = NSRange(input.startIndex..<input.endIndex, in: input)
    return regex.stringByReplacingMatches(in: input, options: [], range: range, withTemplate: "")
  }

  static func extractAllBlocks(_ input: String) -> [String] {
    guard let regex else { return [] }
    let range = NSRange(input.startIndex..<input.endIndex, in: input)
    return regex.matches(in: input, options: [], range: range).compactMap { match in
      guard let range = Range(match.range, in: input) else { return nil }
      let block = String(input[range])
      return block.replacingOccurrences(of: "<think>", with: "")
        .replacingOccurrences(of: "</think>", with: "")
        .replacingOccurrences(of: "<thinking>", with: "")
        .replacingOccurrences(of: "</thinking>", with: "")
        .replacingOccurrences(of: "<analysis>", with: "")
        .replacingOccurrences(of: "</analysis>", with: "")
        .trimmingCharacters(in: .whitespacesAndNewlines)
    }
  }
}
