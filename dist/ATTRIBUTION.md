# 지도 선택에 사용하는 대한민국 경계 데이터

`config/www/ha-map-korea-boundary.geojson`은 NAVER 지도와 Google 지도 중 어느 쪽을 사용할지 정하기 위해 만든 근사 영역입니다. 이 파일은 법적인 영토나 영해선을 나타내지 않습니다.

## 생성 방법

```sh
OPENBLAS_NUM_THREADS=1 prlimit --as=2500000000 -- .venv/bin/python tools/build_korea_boundary.py
```

- 주소 공간 상한을 2.5GB로 제한한 상태에서 실행했을 때 최대 RSS는 약 160MB였고, 실행 시간은 약 4초였습니다.
- 결과 요약과 해시는 `data/korea-boundary-build.json`에 기록합니다.

## 알고리즘

다음 절차는 근사 계산입니다.

1. 한국 육지는 geoBoundaries KOR ADM0와 Natural Earth `Admin-0 claim area`에서 `ADM0_A3=KOR`인 영역을 합쳐서 만듭니다. claim area에는 독도와 UN 관할 한국 도서(백령도, 대청도, 연평도 등 NLL 이남 도서)가 들어 있습니다.
2. 모든 원본 폴리곤을 경도 121.5~134.5, 위도 31~41 범위로 먼저 자르고, 0.1km 기준으로 단순화합니다. 일본 원본(7MB) 전체에 union이나 buffer를 적용하면 메모리가 부족해지므로, 자르기를 가장 먼저 수행합니다.
3. 외국(PRK, JPN, CHN) 육지 가운데 한국 claim area에서 3km 이내에 있는 섬 폴리곤은 제외합니다. 일본 원본에 들어 있는 독도가 여기에 해당합니다.
4. 한국 육지에 12해리(22.224km) 버퍼를 적용합니다. 이 버퍼가 외국 육지의 12해리 버퍼와 겹치는 해역은 해안선을 1.5km 간격으로 샘플링한 점의 Voronoi 분할로 근사 등거리선을 구해 나눕니다.
5. 외국 육지에 0.35km를 더한 영역을 제거하고, 0.3km 기준으로 단순화한 다음 좌표를 소수 넷째 자리까지 남깁니다.
6. 거리 계산에는 동경 127.5도를 중심으로 하는 sinusoidal 투영(km 단위)을 사용합니다. 한반도 주변에서 생기는 거리 오차는 수 % 수준입니다.

geoBoundaries KOR 데이터에는 독도와 마라도가 없습니다. 독도는 Natural Earth claim area를 통해 추가되고, 마라도는 제주 본섬에서 약 9km 떨어져 있어 12해리 버퍼 안에 들어갑니다.

## 원본 데이터 (data/source/)

| 파일 | 출처 | 라이선스 | sha256 |
|---|---|---|---|
| geoBoundaries-KOR-ADM0.geojson | geoBoundaries gbOpen (commit 9469f09), 원천 Natural Earth | Public Domain | 888b11db665e0c013aa3087cafc58aafd0e48b8069a07d8a74e06e80f67ac88f |
| geoBoundaries-PRK-ADM0.geojson | geoBoundaries gbOpen (9469f09), 원천 World Food Programme, OCHA ROAP | CC BY 3.0 IGO (출처 표기 의무) | 40e4c5aaedd442333b83137affe7b3845b281e781f16c4b82f6c755f8694266e |
| geoBoundaries-JPN-ADM0.geojson | geoBoundaries gbOpen (9469f09), 원천 일본 국토교통성 国土数値情報 | CC BY 4.0 (출처 표기 의무) | 8da994e4c3301fa3f2e51dcbc23025d61225e6c15ed9c85e4a063ebc1cd11af8 |
| geoBoundaries-CHN-ADM0.geojson | geoBoundaries gbOpen (9469f09), 원천 Wikimedia Commons | Public Domain | 567c4a547b6318d911b17792d42da3378f3232a2ccfeb07090fdea4ee16c40b7 |
| ne_10m_admin_0_disputed_areas.geojson | Natural Earth v5.1.2 (naturalearthdata.com) | Public Domain | 9cafef8b7dfb6b164dc58f218f981f4ace9f716f6c03795d4c62d1ac9f3d50f5 |

다운로드 URL과 메타데이터는 `data/source/meta-*.json`에 저장된 geoBoundaries API 응답에서 확인할 수 있습니다.

## 출처 표기 문구

이 파일을 배포할 때는 다음 문구를 함께 표기해야 합니다. 라이선스 조건에 맞추기 위해 원문을 그대로 둡니다.

> Boundary data: geoBoundaries (Runfola et al. 2020, gbOpen), including WFP/OCHA ROAP DPRK boundaries (CC BY 3.0 IGO) and MLIT National Land Numerical Information, Japan (CC BY 4.0); Natural Earth (public domain). Modified: clipped, simplified, buffered 12 nmi, approximate median line.

## 한계

- 근사 등거리선은 법적 경계가 아닙니다. 대한해협, NLL, 한강 하구 부근에서는 수 km 오차가 생길 수 있습니다.
- 북방한계선(NLL) 해역은 주변 섬을 기준으로 계산한 12해리 근사로만 반영합니다.
- 확장은 지도 중심점이 이 영역 안에 있는지를 기준으로 지도를 고릅니다. 경계 근처에서 짧은 시간에 지도가 여러 번 바뀌는 현상은 디바운스로 줄입니다.
