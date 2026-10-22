# 칼날 충돌 녹음

- 제작·녹음: **Ben Jaszczak & Brian Nelson / Still North Media**
- 원본: [Medieval sound effects – Weapon impacts](https://opengameart.org/content/medieval-sound-effects-weapon-impacts)
- 라이선스: [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/)
- 다운로드: [원본 묶음 1/2](https://opengameart.org/sites/default/files/medieval_sfx_weapon_on_weapon_1_of_2.7z)
- 사용한 원본: `Sabre Katana Blade on Blade.wav`, `Norse Sword Katana Blade on Blade.wav`, `Sabre Norse Sword Blade on Blade.wav`

칼날끼리 충돌하는 원본에서 네 가지 단발 타격을 발췌했습니다. 앞 무음과 긴
꼬리를 자르고 저역·중저역 공명을 줄인 다음, 짧은 페이드와 음량 보정을 적용했습니다.
원본 녹음의 불규칙한 충격·마찰·잔진동을 유지합니다.

결과는 `js/sword-samples.js`에 44.1kHz 모노 PCM으로 내장되어 있습니다.
첫 공격부터 동기적으로 사용할 수 있으며 `file://`에서도 네트워크 요청 없이 동작합니다.
배경음악과 나머지 효과음은 기존 Web Audio 합성을 사용합니다.

재생성:

```text
python tools/build_sword_samples.py "<원본 WAV 파일을 푼 폴더>"
```

필요 도구는 Python, NumPy, FFmpeg입니다. 원본의 발췌 시각과 SHA-256,
결과 PCM의 SHA-256은 `tools/sword_samples_manifest.json`에 기록되어 있습니다.
