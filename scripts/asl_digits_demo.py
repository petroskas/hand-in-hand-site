import argparse
import json
import random
import sys
import time
import zipfile
from collections import Counter, deque
from pathlib import Path, PurePosixPath

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = ROOT / "models" / "asl-digits"
MODEL_PATH = MODEL_DIR / "model.npz"
IMAGE_SIZE = 64
K_NEIGHBORS = 5
CLASSES = tuple(str(digit) for digit in range(10))


def image_features(image_bytes):
    image = cv2.imdecode(np.frombuffer(image_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Could not decode a dataset image.")

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    gray = cv2.resize(gray, (IMAGE_SIZE, IMAGE_SIZE), interpolation=cv2.INTER_AREA)
    gray = gray.astype(np.float32) / 255.0

    gradient_y, gradient_x = np.gradient(gray)
    magnitude = np.hypot(gradient_x, gradient_y)
    orientation = np.mod(np.arctan2(gradient_y, gradient_x), np.pi)
    bins = np.minimum((orientation * (9 / np.pi)).astype(np.int32), 8)

    rows, columns = np.indices(gray.shape)
    cells = (rows // 8) * 8 + (columns // 8)
    histogram = np.bincount(
        (cells * 9 + bins).ravel(),
        weights=magnitude.ravel(),
        minlength=8 * 8 * 9,
    ).astype(np.float32)
    thumbnail = cv2.resize(gray, (24, 24), interpolation=cv2.INTER_AREA).ravel()
    features = np.concatenate((histogram, thumbnail))
    norm = np.linalg.norm(features)
    if norm:
        features /= norm
    return features


def dataset_entries(archive):
    entries = {label: [] for label in CLASSES}
    for item in archive.infolist():
        path = PurePosixPath(item.filename)
        if len(path.parts) < 4 or path.parts[-3] != "Dataset":
            continue
        label = path.parts[-2]
        suffix = path.suffix.lower()
        if label in entries and suffix in (".jpg", ".jpeg", ".png"):
            entries[label].append(item)
    return entries


def nearest_neighbor_predict(features, train_features, train_labels):
    similarities = train_features @ features
    nearest = np.argpartition(similarities, -K_NEIGHBORS)[-K_NEIGHBORS:]
    votes = np.bincount(train_labels[nearest], minlength=len(CLASSES))
    label = int(np.argmax(votes))
    return label, float(votes[label] / K_NEIGHBORS)


def train(archive_path):
    archive_path = Path(archive_path).expanduser()
    if not archive_path.is_file():
        raise FileNotFoundError(f"Dataset ZIP not found: {archive_path}")

    with zipfile.ZipFile(archive_path) as archive:
        entries = dataset_entries(archive)
        missing = [label for label, images in entries.items() if not images]
        if missing:
            raise ValueError(
                "ZIP is missing image folders for digit classes: " + ", ".join(missing)
            )

        rng = random.Random(42)
        train_features = []
        train_labels = []
        test_features = []
        test_labels = []
        counts = {}

        for label_index, label in enumerate(CLASSES):
            images = sorted(entries[label], key=lambda item: item.filename)
            if len(images) < 5:
                raise ValueError(f"Too few images for digit {label}: {len(images)}")
            rng.shuffle(images)
            test_count = max(1, round(len(images) * 0.2))
            test_images = images[:test_count]
            training_images = images[test_count:]
            counts[label] = len(images)

            for item in training_images:
                train_features.append(image_features(archive.read(item)))
                train_labels.append(label_index)
            for item in test_images:
                test_features.append(image_features(archive.read(item)))
                test_labels.append(label_index)

        train_x = np.asarray(train_features, dtype=np.float32)
        train_y = np.asarray(train_labels, dtype=np.int32)
        test_x = np.asarray(test_features, dtype=np.float32)
        test_y = np.asarray(test_labels, dtype=np.int32)

        correct = 0
        per_class = {label: {"correct": 0, "tested": 0} for label in CLASSES}
        for features, actual in zip(test_x, test_y):
            predicted, _ = nearest_neighbor_predict(features, train_x, train_y)
            per_class[CLASSES[int(actual)]]["tested"] += 1
            if predicted == actual:
                correct += 1
                per_class[CLASSES[int(actual)]]["correct"] += 1

        accuracy = correct / len(test_y)
        MODEL_DIR.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(
            MODEL_PATH,
            features=train_x,
            labels=train_y,
            classes=np.asarray(CLASSES),
        )

        license_info = archive.read("Sign-Language-Digits-Dataset-master/LICENSE")
        (MODEL_DIR / "LICENSE").write_bytes(license_info)
        report = {
            "dataset": "Sign Language Digits Dataset",
            "language": "ASL",
            "task": "still-image handshape classification for digits 0-9",
            "archive": archive_path.name,
            "images_per_class": counts,
            "training_images": len(train_y),
            "test_images": len(test_y),
            "random_image_split_seed": 42,
            "test_accuracy": round(accuracy, 4),
            "per_class": {
                label: {
                    **values,
                    "accuracy": round(values["correct"] / values["tested"], 4),
                }
                for label, values in per_class.items()
            },
            "limitations": [
                "ASL digit data, not Zimbabwean Sign Language.",
                "Still-image classification, not video sign recognition or translation.",
                "Random image split; signer-independent performance is not measured.",
            ],
        }
        (MODEL_DIR / "training-report.json").write_text(
            json.dumps(report, indent=2) + "\n",
            encoding="utf-8",
        )

    print(f"Images: {sum(counts.values())} ({len(train_y)} train, {len(test_y)} test)")
    print(f"Random-split test accuracy: {correct}/{len(test_y)} ({accuracy:.1%})")
    print(f"Model saved to: {MODEL_PATH}")
    print(f"Evaluation report: {MODEL_DIR / 'training-report.json'}")
    print("This ASL-digits experiment is not a ZSL model.")


def run_camera():
    if not MODEL_PATH.is_file():
        raise FileNotFoundError(
            f"Trained model not found: {MODEL_PATH}. Run the train command first."
        )

    with np.load(MODEL_PATH) as model:
        train_features = model["features"]
        train_labels = model["labels"]
        classes = model["classes"].tolist()

    camera = cv2.VideoCapture(0)
    if not camera.isOpened():
        camera.release()
        raise RuntimeError("Could not open camera 0. Check camera connection and permission.")

    recent_predictions = deque(maxlen=5)
    last_prediction_at = 0.0
    prediction = "Hold one hand sign in the center of the frame"

    try:
        while True:
            ok, frame = camera.read()
            if not ok:
                raise RuntimeError("Could not read a frame from the camera.")

            height, width = frame.shape[:2]
            side = int(min(height, width) * 0.65)
            left = (width - side) // 2
            top = (height - side) // 2
            roi = frame[top:top + side, left:left + side]
            now = time.monotonic()

            if now - last_prediction_at >= 0.25:
                feature = image_features(cv2.imencode(".jpg", roi)[1].tobytes())
                label_index, confidence = nearest_neighbor_predict(
                    feature, train_features, train_labels
                )
                recent_predictions.append(
                    (label_index, confidence) if confidence >= 0.6 else None
                )
                stable = [
                    item[0] for item in recent_predictions if item is not None
                ]
                if stable:
                    label, votes = Counter(stable).most_common(1)[0]
                    if votes >= 3:
                        prediction = (
                            f"ASL digit {classes[label]} "
                            f"(nearest-neighbor agreement {votes}/{len(recent_predictions)})"
                        )
                    else:
                        prediction = "Uncertain - hold one digit sign steady"
                else:
                    prediction = "Uncertain - hold one digit sign steady"
                last_prediction_at = now

            cv2.rectangle(frame, (left, top), (left + side, top + side), (74, 190, 255), 2)
            cv2.putText(
                frame,
                "ASL DIGITS DEMO ONLY - NOT ZSL",
                (16, 30),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.65,
                (255, 255, 255),
                2,
                cv2.LINE_AA,
            )
            cv2.putText(
                frame,
                prediction,
                (16, height - 20),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                (255, 255, 255),
                2,
                cv2.LINE_AA,
            )
            cv2.imshow("ASL digits experiment - press Q to quit", frame)
            if cv2.waitKey(1) & 0xFF in (ord("q"), ord("Q")):
                break
    finally:
        camera.release()
        cv2.destroyAllWindows()


def main():
    parser = argparse.ArgumentParser(
        description="Train/test an isolated ASL digits image-classification experiment."
    )
    commands = parser.add_subparsers(dest="command", required=True)
    train_parser = commands.add_parser("train", help="Train from the dataset ZIP.")
    train_parser.add_argument("archive", help="Path to Sign-Language-Digits-Dataset ZIP.")
    commands.add_parser("camera", help="Run the separate ASL-digits webcam demo.")
    args = parser.parse_args()

    if args.command == "train":
        train(args.archive)
    else:
        run_camera()


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, zipfile.BadZipFile, RuntimeError) as error:
        print(f"Error: {error}", file=sys.stderr)
        raise SystemExit(1) from error
