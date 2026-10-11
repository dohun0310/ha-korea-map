# 대한민국 지도 엔진 선택용 경계 데이터

`config/www/ha-map-korea-boundary.geojson` 은 **지도 렌더러(NAVER/Google) 선택용 근사 영역**이며 법적 영토·영해선이 아닙니다.

## 생성 방법

```sh
OPENBLAS_NUM_THREADS=1 prlimit --as=2500000000 -- .venv/bin/python tools/build_korea_boundary.py
```

- 최대 RSS 약 160MB, 약 4초 (2.5GB 주소공간 상한에서 실행 확인).
- 결과 요약/해시: `data/korea-boundary-build.json`.

## 알고리즘 (근사)

1. 한국 육지 = geoBoundaries KOR ADM0 ∪ Natural Earth `Admin-0 claim area` 중 `ADM0_A3=KOR` (Dokdo, Korean islands under UN jurisdiction = 백령·대청·연평 등 NLL 이남 도서).
2. 모든 원본 폴리곤을 경도 121.5–134.5, 위도 31–41 bbox 로 먼저 자르고 0.1km 단순화 (일본 원본 7MB 전체를 union/buffer 하지 않음 — 이전 OOM 원인).
3. 외국 육지(PRK/JPN/CHN)에서 한국 claim area 3km 이내의 섬 폴리곤(일본 원본에 포함된 독도 등)은 제외.
4. 한국 육지를 12해리(22.224km) 버퍼. 외국 육지 12해리 버퍼와 겹치는 해역은 해안선 샘플점(1.5km 간격) Voronoi 로 근사 등거리선 분할.
5. 외국 육지 + 0.35km 를 제거, 0.3km 단순화, 좌표 소수 4자리.
6. 투영: 127.5°E 중심 sinusoidal(km). 한반도 주변 거리 오차 수 %.

geoBoundaries KOR 에는 독도·마라도가 없지만, 독도는 Natural Earth claim area 로 추가되고 마라도(제주 본섬 약 9km)는 12해리 버퍼로 포함됩니다.

## 원본 (data/source/)

| 파일 | 출처 | 라이선스 | sha256 |
|---|---|---|---|
| geoBoundaries-KOR-ADM0.geojson | geoBoundaries gbOpen (commit 9469f09), 원천 Natural Earth | Public Domain | 888b11db665e0c013aa3087cafc58aafd0e48b8069a07d8a74e06e80f67ac88f |
| geoBoundaries-PRK-ADM0.geojson | geoBoundaries gbOpen (9469f09), 원천 World Food Programme, OCHA ROAP | **CC BY 3.0 IGO** (출처 표기 의무) | 40e4c5aaedd442333b83137affe7b3845b281e781f16c4b82f6c755f8694266e |
| geoBoundaries-JPN-ADM0.geojson | geoBoundaries gbOpen (9469f09), 원천 일본 국토교통성 国土数値情報 | **CC BY 4.0** (출처 표기 의무) | 8da994e4c3301fa3f2e51dcbc23025d61225e6c15ed9c85e4a063ebc1cd11af8 |
| geoBoundaries-CHN-ADM0.geojson | geoBoundaries gbOpen (9469f09), 원천 Wikimedia Commons | Public Domain | 567c4a547b6318d911b17792d42da3378f3232a2ccfeb07090fdea4ee16c40b7 |
| ne_10m_admin_0_disputed_areas.geojson | Natural Earth v5.1.2 (naturalearthdata.com) | Public Domain | 9cafef8b7dfb6b164dc58f218f981f4ace9f716f6c03795d4c62d1ac9f3d50f5 |

다운로드 URL·메타데이터: `data/source/meta-*.json` (geoBoundaries API 응답).

## 필수 출처 표기 문구

> Boundary data: geoBoundaries (Runfola et al. 2020, gbOpen), including WFP/OCHA ROAP DPRK boundaries (CC BY 3.0 IGO) and MLIT National Land Numerical Information, Japan (CC BY 4.0); Natural Earth (public domain). Modified: clipped, simplified, buffered 12 nmi, approximate median line.

## 한계

- 근사 등거리선은 법적 경계가 아니며 대한해협·NLL·한강 하구 부근에서 수 km 오차가 있을 수 있습니다.
- 북방한계선(NLL) 해역은 주변 섬 기준 12해리 근사로만 반영됩니다.
- 경계 판정은 지도 중심점 기준이며, 경계 근처에서는 디바운스로 짧은 왕복 전환을 줄입니다.
