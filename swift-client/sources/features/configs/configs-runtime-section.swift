// CRITICAL
import SwiftUI

struct ConfigsRuntimeSection: View {
  let runtime: SystemRuntimeInfo?
  let llamaBin: String?

  var body: some View {
    if let runtime {
      Section("Runtime") {
        RuntimeRow(label: "CUDA Driver", value: runtime.cuda.driverVersion ?? "Unknown")
        RuntimeRow(label: "CUDA Runtime", value: runtime.cuda.cudaVersion ?? "Unknown")
        RuntimeRow(label: "GPU Count", value: String(runtime.gpus.count))
        RuntimeRow(label: "GPU Types", value: runtime.gpus.types.isEmpty ? "Unknown" : runtime.gpus.types.joined(separator: ", "))
      }

      Section("Backends") {
        BackendRow(
          name: "vLLM",
          info: runtime.backends.vllm,
          detail: runtime.backends.vllm.version ?? "Unknown",
          secondary: runtime.backends.vllm.pythonPath
        )
        BackendRow(
          name: "SGLang",
          info: runtime.backends.sglang,
          detail: runtime.backends.sglang.version ?? "Unknown",
          secondary: runtime.backends.sglang.pythonPath
        )
        BackendRow(
          name: "llama.cpp",
          info: runtime.backends.llamacpp,
          detail: runtime.backends.llamacpp.version ?? "Unknown",
          secondary: runtime.backends.llamacpp.binaryPath ?? llamaBin
        )
      }
    }
  }
}

private struct RuntimeRow: View {
  let label: String
  let value: String

  var body: some View {
    HStack {
      Text(label)
      Spacer()
      Text(value)
        .font(AppTheme.monoFont)
        .foregroundColor(AppTheme.muted)
        .multilineTextAlignment(.trailing)
    }
  }
}

private struct BackendRow: View {
  let name: String
  let info: RuntimeBackendInfo
  let detail: String
  let secondary: String?

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack {
        Text(name)
        Spacer()
        BadgeView(text: info.installed ? "Installed" : "Missing", color: info.installed ? AppTheme.success : AppTheme.error)
      }
      Text(detail)
        .font(AppTheme.captionFont)
        .foregroundColor(AppTheme.muted)
      if let secondary, !secondary.isEmpty {
        Text(secondary)
          .font(AppTheme.monoFont)
          .foregroundColor(AppTheme.muted)
      }
    }
    .padding(.vertical, 4)
  }
}
