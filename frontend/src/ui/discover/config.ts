import { RefreshCw, Download, Heart, TrendingUp } from "lucide-react";

export const TASKS = [
  { value: "", label: "All Tasks" },
  { value: "text-generation", label: "Text Generation" },
  { value: "text2text-generation", label: "Text-to-Text" },
  { value: "conversational", label: "Conversational" },
  { value: "fill-mask", label: "Fill Mask" },
  { value: "question-answering", label: "Question Answering" },
  { value: "summarization", label: "Summarization" },
  { value: "translation", label: "Translation" },
  { value: "feature-extraction", label: "Feature Extraction" },
  { value: "image-to-text", label: "Image to Text" },
];

export const SORT_OPTIONS = [
  { value: "trending", label: "Trending", icon: TrendingUp },
  { value: "downloads", label: "Most Downloads", icon: Download },
  { value: "likes", label: "Most Likes", icon: Heart },
  { value: "modified", label: "Recently Updated", icon: RefreshCw },
];

export const QUANTIZATION_TAGS = [
  "awq",
  "gptq",
  "gguf",
  "exl2",
  "fp8",
  "fp16",
  "bf16",
  "int8",
  "int4",
  "w4a16",
  "w8a16",
];
