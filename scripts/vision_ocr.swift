import Foundation
import Vision
import AppKit

struct OCRLine: Codable {
    let text: String
    let confidence: Float
}

struct OCRResult: Codable {
    let path: String
    let lines: [OCRLine]
}

func cgImage(from path: String) -> CGImage? {
    guard let nsImage = NSImage(contentsOfFile: path) else { return nil }
    var rect = NSRect(origin: .zero, size: nsImage.size)
    return nsImage.cgImage(forProposedRect: &rect, context: nil, hints: nil)
}

let args = Array(CommandLine.arguments.dropFirst())
guard !args.isEmpty else {
    fputs("usage: vision_ocr.swift <image>...\n", stderr)
    exit(1)
}

var results: [OCRResult] = []

for path in args {
    guard let image = cgImage(from: path) else {
        results.append(OCRResult(path: path, lines: []))
        continue
    }

    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false

    let handler = VNImageRequestHandler(cgImage: image, options: [:])

    do {
        try handler.perform([request])
        let observations = request.results ?? []
        let lines = observations.compactMap { observation -> OCRLine? in
            guard let top = observation.topCandidates(1).first else { return nil }
            return OCRLine(text: top.string, confidence: top.confidence)
        }
        results.append(OCRResult(path: path, lines: lines))
    } catch {
        results.append(OCRResult(path: path, lines: []))
    }
}

let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
let data = try encoder.encode(results)
FileHandle.standardOutput.write(data)
