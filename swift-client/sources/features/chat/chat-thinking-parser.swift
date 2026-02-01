// CRITICAL
import Foundation

struct ThinkingResult {
  let thinking: String?
  let main: String
}

enum ThinkingParser {
  private static let openTagRegex = try? NSRegularExpression(
    pattern: "<(think|thinking|analysis)>",
    options: [.caseInsensitive]
  )
  private static let blockRegex = try? NSRegularExpression(
    pattern: "<(think|thinking|analysis)>[\\s\\S]*?</(think|thinking|analysis)>",
    options: [.caseInsensitive]
  )
  private static let stripTagsRegex = try? NSRegularExpression(
    pattern: "</?(think|thinking|analysis)>",
    options: [.caseInsensitive]
  )

  static func parse(_ input: String) -> ThinkingResult {
    guard let openTagRegex else { return ThinkingResult(thinking: nil, main: input) }
    let fullRange = NSRange(input.startIndex..<input.endIndex, in: input)
    guard let open = openTagRegex.firstMatch(in: input, options: [], range: fullRange),
          open.numberOfRanges >= 2,
          let openRange = Range(open.range(at: 0), in: input),
          let tagRange = Range(open.range(at: 1), in: input)
    else {
      return ThinkingResult(thinking: nil, main: input)
    }

    let tag = String(input[tagRange])
    let searchStart = open.range(at: 0).location + open.range(at: 0).length
    let searchRange = NSRange(location: searchStart, length: max(0, fullRange.length - searchStart))
    let closePattern = "</\(NSRegularExpression.escapedPattern(for: tag))>"
    let closeRegex = try? NSRegularExpression(pattern: closePattern, options: [.caseInsensitive])

    if let close = closeRegex?.firstMatch(in: input, options: [], range: searchRange),
       let closeRange = Range(close.range(at: 0), in: input) {
      let thinking = String(input[openRange.upperBound..<closeRange.lowerBound])
        .trimmingCharacters(in: .whitespacesAndNewlines)
      let before = String(input[..<openRange.lowerBound])
      let after = String(input[closeRange.upperBound...])
      return ThinkingResult(thinking: thinking, main: before + after)
    }

    let thinking = String(input[openRange.upperBound...])
      .trimmingCharacters(in: .whitespacesAndNewlines)
    let main = String(input[..<openRange.lowerBound])
    return ThinkingResult(thinking: thinking, main: main)
  }

  static func stripThinkingBlocks(_ input: String) -> String {
    guard let blockRegex else { return input }
    let range = NSRange(input.startIndex..<input.endIndex, in: input)
    return blockRegex.stringByReplacingMatches(in: input, options: [], range: range, withTemplate: "")
  }

  static func extractAllBlocks(_ input: String) -> [String] {
    guard let blockRegex else { return [] }
    let range = NSRange(input.startIndex..<input.endIndex, in: input)
    return blockRegex.matches(in: input, options: [], range: range).compactMap { match in
      guard let r = Range(match.range, in: input) else { return nil }
      let block = String(input[r])
      guard let stripTagsRegex else {
        return block.trimmingCharacters(in: .whitespacesAndNewlines)
      }
      let blockRange = NSRange(block.startIndex..<block.endIndex, in: block)
      let inner = stripTagsRegex.stringByReplacingMatches(in: block, options: [], range: blockRange, withTemplate: "")
      return inner.trimmingCharacters(in: .whitespacesAndNewlines)
    }
  }
}
