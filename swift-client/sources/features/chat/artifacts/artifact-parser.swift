import Foundation

enum ArtifactParser {
  // <artifact type="html" title="...">...</artifact>
  private static let tagRegex = try? NSRegularExpression(
    pattern: #"<artifact\s+type="([^"]+)"(?:\s+title="([^"]*)")?\s*>([\s\S]*?)</artifact>"#,
    options: [.caseInsensitive]
  )

  // ```artifact-html ... ``` or ```artifact-react ... ```
  private static let codeBlockRegex = try? NSRegularExpression(
    pattern: #"```artifact-(html|react|svg|markdown)\s*\n([\s\S]*?)```"#,
    options: []
  )

  // ```html ... ``` or ```svg ... ``` (implicit)
  private static let implicitBlockRegex = try? NSRegularExpression(
    pattern: #"```(html|svg)\s*\n([\s\S]*?)```"#,
    options: []
  )

  // Combined regex for stripping all artifact patterns
  private static let stripRegex = try? NSRegularExpression(
    pattern: #"<artifact\s+type="[^"]+"(?:\s+title="[^"]*")?\s*>[\s\S]*?</artifact>|```artifact-(html|react|svg|markdown)\s*\n[\s\S]*?```|```(html|svg)\s*\n[\s\S]*?```"#,
    options: [.caseInsensitive]
  )

  static func parse(_ input: String) -> ArtifactParseResult {
    guard !input.isEmpty else { return ArtifactParseResult(text: "", artifacts: []) }

    var artifacts: [Artifact] = []
    var text = input
    let nsInput = input as NSString
    let fullRange = NSRange(location: 0, length: nsInput.length)

    // Pattern 1: <artifact type="html" title="...">...</artifact>
    if let regex = tagRegex {
      let matches = regex.matches(in: input, options: [], range: fullRange)
      for match in matches.reversed() {
        guard let typeRange = Range(match.range(at: 1), in: input),
              let codeRange = Range(match.range(at: 3), in: input),
              let fullMatchRange = Range(match.range, in: input) else { continue }

        let typeStr = String(input[typeRange]).lowercased()
        guard let type = normalizeType(typeStr) else { continue }

        let title: String
        if match.range(at: 2).location != NSNotFound, let titleRange = Range(match.range(at: 2), in: input) {
          title = String(input[titleRange])
        } else {
          title = type.label
        }

        let code = String(input[codeRange]).trimmingCharacters(in: .whitespacesAndNewlines)
        let id = "artifact-\(artifacts.count)-\(UUID().uuidString.prefix(8))"
        artifacts.insert(Artifact(id: id, type: type, title: title, code: code), at: 0)
        text = text.replacingCharacters(in: fullMatchRange, with: "[Artifact: \(title)]")
      }
    }

    // Pattern 2: ```artifact-html ... ```
    if let regex = codeBlockRegex {
      let currentText = text
      let nsText = currentText as NSString
      let range = NSRange(location: 0, length: nsText.length)
      let matches = regex.matches(in: currentText, options: [], range: range)
      for match in matches.reversed() {
        guard let typeRange = Range(match.range(at: 1), in: currentText),
              let codeRange = Range(match.range(at: 2), in: currentText),
              let fullMatchRange = Range(match.range, in: currentText) else { continue }

        let typeStr = String(currentText[typeRange]).lowercased()
        guard let type = normalizeType(typeStr) else { continue }

        let code = String(currentText[codeRange]).trimmingCharacters(in: .whitespacesAndNewlines)
        let id = "artifact-\(artifacts.count)-\(UUID().uuidString.prefix(8))"
        artifacts.append(Artifact(id: id, type: type, title: type.label, code: code))
        text = text.replacingCharacters(in: fullMatchRange, with: "[Artifact: \(type.label)]")
      }
    }

    // Pattern 3: ```html ... ``` or ```svg ... ``` (implicit)
    if let regex = implicitBlockRegex {
      let currentText = text
      let nsText = currentText as NSString
      let range = NSRange(location: 0, length: nsText.length)
      let matches = regex.matches(in: currentText, options: [], range: range)
      for match in matches.reversed() {
        guard let typeRange = Range(match.range(at: 1), in: currentText),
              let codeRange = Range(match.range(at: 2), in: currentText),
              let fullMatchRange = Range(match.range, in: currentText) else { continue }

        let typeStr = String(currentText[typeRange]).lowercased()
        guard let type = normalizeType(typeStr) else { continue }

        let code = String(currentText[codeRange]).trimmingCharacters(in: .whitespacesAndNewlines)
        // Only treat as artifact if code is substantial (>80 chars)
        guard code.count > 80 else { continue }
        let id = "artifact-\(artifacts.count)-\(UUID().uuidString.prefix(8))"
        artifacts.append(Artifact(id: id, type: type, title: type.label, code: code))
        text = text.replacingCharacters(in: fullMatchRange, with: "[Artifact: \(type.label)]")
      }
    }

    return ArtifactParseResult(text: text, artifacts: artifacts)
  }

  static func stripArtifactBlocks(_ input: String) -> String {
    guard let regex = stripRegex else { return input }
    let range = NSRange(input.startIndex..<input.endIndex, in: input)
    return regex.stringByReplacingMatches(in: input, options: [], range: range, withTemplate: "")
      .trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private static func normalizeType(_ raw: String) -> ArtifactType? {
    switch raw {
    case "html": return .html
    case "svg": return .svg
    case "react", "jsx", "tsx": return .react
    case "markdown", "md": return .markdown
    default: return nil
    }
  }
}
