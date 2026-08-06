// 숙제 사진: 촬영/선택 → 리사이즈·압축 → Storage 업로드.
//
// 라이브러리 선택 근거:
//   · expo-image-picker      — Expo 공식 모듈. 카메라와 갤러리를 한 API 로 다루고, **웹에서는
//                              파일 선택으로 동작**해서 :8081 미리보기로도 경로를 시험할 수 있다.
//                              react-native-vision-camera 는 이미 있지만 '카메라 뷰' 라이브러리라
//                              문서 촬영 UI 를 처음부터 만들어야 해서 이 용도에 맞지 않는다.
//   · expo-image-manipulator — 업로드 전에 긴 변을 줄이고 JPEG 로 변환한다. 웹에서도 동작한다(canvas).
//
// 왜 리사이즈하는가: Claude 비전은 이미지를 긴 변 ~1568px 로 줄여서 읽는다. 원본 4000px 을
// 올려도 판독 품질은 같고 업로드·저장 비용만 늘어난다. HEIC(iOS 원본)는 비전 API 가 못 읽으므로
// 여기서 JPEG 로 바꿔 둔다 — 버킷도 HEIC 를 받지 않는다.

import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";

import {
  HOMEWORK_PHOTO_JPEG_QUALITY,
  HOMEWORK_PHOTO_MAX_COUNT,
  HOMEWORK_PHOTO_MAX_LONG_EDGE,
  buildHomeworkPhotoPath,
  decodeBase64
} from "@ssamplanner/shared";

import { supabase } from "./supabaseClient";

export const HOMEWORK_PHOTO_BUCKET = "homework-photos";

export type PickedPhoto = {
  /** 화면 미리보기용 로컬 URI. 업로드 전에는 이것만 있다. */
  uri: string;
  width: number;
  height: number;
  mimeType: string;
  bytes?: number;
};

export type PickSource = "camera" | "library";

/**
 * 사진을 고른다. 남은 장수만큼만 받는다.
 *
 * 카메라는 실기기에서만 의미가 있다 — 웹 미리보기에서는 브라우저가 파일 선택으로 대체하거나
 * 권한을 거부할 수 있으므로, 그 경우 갤러리(파일 선택) 경로로 시험한다.
 */
export async function pickHomeworkPhotos(source: PickSource, remainingSlots: number): Promise<PickedPhoto[]> {
  const limit = Math.max(0, Math.min(remainingSlots, HOMEWORK_PHOTO_MAX_COUNT));
  if (limit === 0) return [];

  if (source === "camera") {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new Error("카메라 권한이 필요해요. 설정에서 허용해 주세요.");
  } else {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) throw new Error("사진 접근 권한이 필요해요. 설정에서 허용해 주세요.");
  }

  const result =
    source === "camera"
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1 })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          allowsMultipleSelection: true,
          selectionLimit: limit,
          quality: 1
        });

  if (result.canceled) return [];

  return result.assets.slice(0, limit).map((asset) => ({
    uri: asset.uri,
    width: asset.width,
    height: asset.height,
    // 웹 파일 선택에서는 mimeType 이 비는 경우가 있다. 어차피 아래에서 JPEG 로 변환하므로
    // 알 수 없으면 image/jpeg 로 본다 — 최종 업로드 형식이 그것이다.
    mimeType: asset.mimeType ?? "image/jpeg",
    bytes: asset.fileSize
  }));
}

/** 긴 변을 줄이고 JPEG 로 압축한다. base64 로 받아 바이트로 바꿔 업로드한다. */
async function toUploadableJpeg(photo: PickedPhoto): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const longEdge = Math.max(photo.width, photo.height);
  const actions: ImageManipulator.Action[] =
    longEdge > HOMEWORK_PHOTO_MAX_LONG_EDGE
      ? [
          photo.width >= photo.height
            ? { resize: { width: HOMEWORK_PHOTO_MAX_LONG_EDGE } }
            : { resize: { height: HOMEWORK_PHOTO_MAX_LONG_EDGE } }
        ]
      : [];

  const processed = await ImageManipulator.manipulateAsync(photo.uri, actions, {
    base64: true,
    compress: HOMEWORK_PHOTO_JPEG_QUALITY,
    format: ImageManipulator.SaveFormat.JPEG
  });

  if (!processed.base64) throw new Error("사진을 준비하지 못했어요. 다시 시도해 주세요.");
  return { bytes: decodeBase64(processed.base64), width: processed.width, height: processed.height };
}

export type UploadedPhoto = { path: string; bytes: number };

/**
 * Storage 에 올리고 저장할 경로들을 돌려준다.
 *
 * 경로: `${studentId}/${todoId}/${submissionKey}/page-N.jpg`
 *   · 첫 폴더가 학생 uid 여야 Storage 정책을 통과한다.
 *   · submissionKey 로 제출마다 폴더를 분리한다 — 같은 경로에 덮어쓰면 이전 제출의 사진이
 *     사라져 그 제출의 AI 판정 근거가 없어진다(attempt 는 경로 스냅샷만 갖는다).
 *
 * 실패 시 이미 올린 파일을 되돌린다. 남겨 두면 아무 제출도 가리키지 않는 고아 파일이 된다.
 */
export async function uploadHomeworkPhotos(input: {
  studentId: string;
  todoId: string;
  submissionKey: string;
  photos: PickedPhoto[];
}): Promise<UploadedPhoto[]> {
  const uploaded: UploadedPhoto[] = [];
  try {
    for (let index = 0; index < input.photos.length; index++) {
      const { bytes } = await toUploadableJpeg(input.photos[index]!);
      const path = buildHomeworkPhotoPath({
        studentId: input.studentId,
        todoId: input.todoId,
        submissionKey: input.submissionKey,
        index
      });
      const { error } = await supabase.storage.from(HOMEWORK_PHOTO_BUCKET).upload(path, bytes, {
        contentType: "image/jpeg",
        upsert: false
      });
      if (error) throw error;
      uploaded.push({ path, bytes: bytes.byteLength });
    }
    return uploaded;
  } catch (error) {
    await removeHomeworkPhotos(uploaded.map((item) => item.path));
    throw error;
  }
}

/** 업로드한 파일 정리. 학생은 자기 폴더만 지울 수 있다(Storage 정책). */
export async function removeHomeworkPhotos(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await supabase.storage.from(HOMEWORK_PHOTO_BUCKET).remove(paths);
}

/** 비공개 버킷이므로 열람에는 서명 URL 이 필요하다. */
export async function createHomeworkPhotoUrls(paths: string[], expiresInSeconds = 60 * 10): Promise<string[]> {
  if (paths.length === 0) return [];
  const { data, error } = await supabase.storage
    .from(HOMEWORK_PHOTO_BUCKET)
    .createSignedUrls(paths, expiresInSeconds);
  if (error) throw error;
  return (data ?? []).map((item) => item.signedUrl).filter((url): url is string => Boolean(url));
}
