#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import tempfile
import time
from pathlib import Path


DEFAULT_FFMPEG = "/opt/homebrew/bin/ffmpeg"
DEFAULT_FFPROBE = "/opt/homebrew/bin/ffprobe"


def safe_name(value: str) -> str:
    value = re.sub(r'[\\/:*?"<>|]+', " ", value)
    value = re.sub(r"\s+", " ", value).strip()
    return value[:120] or "untitled"


def clean_text(text: str) -> str:
    text = re.sub(r"<\|[^|]+?\|>", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def run(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True)


def duration_seconds(path: Path, ffprobe: str) -> float:
    proc = subprocess.run(
        [ffprobe, "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        check=True,
        text=True,
        capture_output=True,
    )
    return float(proc.stdout.strip())


def segment_audio(audio: Path, chunks_dir: Path, chunk_seconds: int, ffmpeg: str) -> list[Path]:
    chunks_dir.mkdir(parents=True, exist_ok=True)
    for old in chunks_dir.glob("chunk-*.wav"):
        old.unlink()
    run(
        [
            ffmpeg,
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(audio),
            "-ac",
            "1",
            "-ar",
            "16000",
            "-f",
            "segment",
            "-segment_time",
            str(chunk_seconds),
            "-reset_timestamps",
            "1",
            str(chunks_dir / "chunk-%03d.wav"),
        ]
    )
    chunks = sorted(chunks_dir.glob("chunk-*.wav"))
    if not chunks:
        raise RuntimeError("ffmpeg did not produce any audio chunks")
    return chunks


def load_metadata(path: Path | None) -> dict:
    if not path:
        return {}
    return json.loads(path.expanduser().read_text(encoding="utf-8"))


def transcribe(args: argparse.Namespace) -> dict:
    from funasr import AutoModel

    source_meta = load_metadata(args.metadata)
    audio = args.audio.expanduser().resolve()
    if not audio.exists():
        raise FileNotFoundError(audio)

    title = args.title or source_meta.get("title") or audio.stem
    video_id = args.video_id or source_meta.get("video_id") or ""
    source_url = args.source_url or source_meta.get("webpage_url") or source_meta.get("source_url") or ""

    if args.output_dir:
        out_dir = args.output_dir.expanduser().resolve()
    else:
        out_dir = args.raw_root.expanduser().resolve() / "youtube" / safe_name(title)
    out_dir.mkdir(parents=True, exist_ok=True)

    audio_copy = out_dir / f"audio{audio.suffix.lower() or '.m4a'}"
    if audio.resolve() != audio_copy.resolve():
        shutil.copy2(audio, audio_copy)

    temp_root = Path(args.temp_dir).expanduser().resolve() if args.temp_dir else Path(tempfile.mkdtemp(prefix="youtube-funasr-"))
    chunks_dir = temp_root / "chunks"
    chunks = segment_audio(audio_copy, chunks_dir, args.chunk_seconds, args.ffmpeg)

    started = time.time()
    model = AutoModel(
        model=args.model,
        vad_model=args.vad_model,
        vad_kwargs={"max_single_segment_time": args.max_single_segment_time},
        trust_remote_code=True,
        device=args.device,
        disable_update=True,
    )

    segments = []
    offset = 0.0
    for idx, chunk in enumerate(chunks):
        chunk_started = time.time()
        dur = duration_seconds(chunk, args.ffprobe)
        print(f"transcribing {chunk.name} ({dur:.1f}s), offset={offset:.1f}s", flush=True)
        result = model.generate(
            input=str(chunk),
            language=args.language,
            use_itn=True,
            batch_size_s=args.batch_size_s,
            merge_vad=True,
            merge_length_s=args.merge_length_s,
        )
        raw_text = "\n\n".join(item.get("text", "") for item in result if isinstance(item, dict))
        segments.append(
            {
                "chunk": chunk.name,
                "chunk_index": idx,
                "offset_seconds": round(offset, 3),
                "duration_seconds": round(dur, 3),
                "elapsed_seconds": round(time.time() - chunk_started, 3),
                "raw_result": result,
                "raw_text": raw_text,
                "text": clean_text(raw_text),
            }
        )
        offset += dur

    elapsed = time.time() - started
    full_text = "\n\n".join(seg["text"] for seg in segments if seg["text"]).strip()
    record = {
        "source": "youtube",
        "source_provider": source_meta.get("source_provider") or args.source_provider,
        "source_url": source_url,
        "video_id": video_id,
        "title": title,
        "channel": source_meta.get("channel", ""),
        "audio_file": audio_copy.name,
        "model": args.model,
        "vad_model": args.vad_model,
        "language": args.language,
        "chunk_seconds": args.chunk_seconds,
        "audio_duration_seconds": round(offset, 3),
        "elapsed_seconds": round(elapsed, 3),
        "segments": segments,
    }

    (out_dir / "transcript.json").write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    (out_dir / "transcript.txt").write_text(full_text + "\n", encoding="utf-8")

    md_segments = []
    for seg in segments:
        mm = int(seg["offset_seconds"] // 60)
        ss = int(seg["offset_seconds"] % 60)
        md_segments.append(f"### {mm:02d}:{ss:02d}\n\n{seg['text']}")
    md = "\n".join(
        [
            f"# {title} - FunASR Transcript",
            "",
            f"- Source: {source_url or video_id or 'youtube'}",
            f"- Channel: {source_meta.get('channel', '')}",
            f"- Audio: `{audio_copy.name}`",
            f"- Model: `{args.model}`",
            f"- VAD: `{args.vad_model}`",
            f"- Language: `{args.language}`",
            f"- Audio duration: {offset:.1f}s",
            f"- Runtime: {elapsed:.1f}s",
            "",
            "## Transcript",
            "",
            "\n\n".join(md_segments),
            "",
        ]
    )
    (out_dir / "transcript.md").write_text(md, encoding="utf-8")

    metadata = {key: record[key] for key in ["source", "source_provider", "source_url", "video_id", "title", "channel", "audio_file", "model", "vad_model", "language", "chunk_seconds", "audio_duration_seconds", "elapsed_seconds"]}
    metadata["transcript_files"] = ["transcript.md", "transcript.txt", "transcript.json"]
    (out_dir / "metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")

    if not args.keep_chunks and not args.temp_dir:
        shutil.rmtree(temp_root, ignore_errors=True)

    return {"out_dir": str(out_dir), "elapsed_seconds": round(elapsed, 3), "chars": len(full_text), "segments": len(segments)}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Transcribe YouTube audio into llm-wiki raw/ with FunASR.")
    parser.add_argument("--audio", type=Path, required=True)
    parser.add_argument("--metadata", type=Path)
    parser.add_argument("--title", default="")
    parser.add_argument("--video-id", default="")
    parser.add_argument("--source-url", default="")
    parser.add_argument("--source-provider", default="yt-dlp")
    parser.add_argument("--raw-root", type=Path, default=Path("~/rep/llm-wiki/raw"))
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--temp-dir")
    parser.add_argument("--keep-chunks", action="store_true")
    parser.add_argument("--ffmpeg", default=DEFAULT_FFMPEG)
    parser.add_argument("--ffprobe", default=DEFAULT_FFPROBE)
    parser.add_argument("--model", default="iic/SenseVoiceSmall")
    parser.add_argument("--vad-model", default="fsmn-vad")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--language", default="en")
    parser.add_argument("--chunk-seconds", type=int, default=600)
    parser.add_argument("--max-single-segment-time", type=int, default=30000)
    parser.add_argument("--batch-size-s", type=int, default=60)
    parser.add_argument("--merge-length-s", type=int, default=15)
    return parser.parse_args()


def main() -> None:
    result = transcribe(parse_args())
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
