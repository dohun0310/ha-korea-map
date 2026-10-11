# 공식 NAVER / Google Maps SDK — 격리 HA 실험실

## 현재 상태와 경계

실제 `naver.maps.Map` / `google.maps.Map` 및 각 SDK `OverlayView`, `Circle`, `Polyline`을 생성하는 어댑터와 HA MapEngine Router를 구현했다. SDK 모의 facade가 아니다. SDK fake는 Node 단위 테스트에만 사용한다. **API 키가 아직 없어 실제 외부 지도, 인증·과금·지리적 타일·SDK의 Shadow DOM 동작은 검증하지 못했다.** 키 없는 배포는 `mode: native`이며 SDK 스크립트를 요청하지 않는다.

현재 실행 컨테이너 이름은 `ha-map-lab`, HA 2026.10.1 / frontend 20260930.3, LAN `<HA 호스트>:18123`이다. Docker 네트워크·권한·포트·다른 HA는 변경하지 않았다. `/map/0` 기본 지도 대시보드만 소유한다. 다른 대시보드, 편집기, `_forceLeaflet`/rasterOnly, 알 수 없는 빌드/메서드는 원래 factory를 유지한다. 기존 `extra_module_url: /local/ha-map-lab-bootstrap.mjs?v=dashboard-2` 등록을 그대로 활용하며 bootstrap 내부 import만 `official-1`로 갱신했다.

**사적·합성 좌표의 lab 전용 opt-in 실험**이다. production 라이선스 승인이나 다중 지도 제공자 이용 약관의 적합성을 보장하지 않는다. 실사용 위치 데이터로 검증하기 전에 동의와 약관을 별도로 확인해야 한다.

## 키 공급 및 실행

키를 채팅/로그에 붙이지 말고 이 lab 디렉터리의 비공개 파일에 작성한다. NAVER Client Secret은 필요 없으며 파일에 넣지 않는다.

```sh
cd <저장소 루트>
test -e provider-keys.env || install -m 600 provider-keys.env.example provider-keys.env
chmod 600 provider-keys.env
# 편집기로 아래 두 필드 중 사용할 제공자의 공개 브라우저 키를 입력
# NAVER_MAP_KEY_ID=
# GOOGLE_MAPS_API_KEY=
python3 generate-provider-config.py --provider naver --opt-in
# 또는
python3 generate-provider-config.py --provider google --opt-in
```

`provider-keys.env`는 source/eval하지 않는다. generator는 지정한 두 필드만 읽고 값 형식을 검사한다. 관련 없는 변수는 브라우저에 보내지 않는다. 기본은 선택한 제공자의 키만 출력한다. 생성된 `/local/ha-map-lab-config.mjs`는 **브라우저가 볼 수 있는 키**만 담으며 HA 토큰·서버 secret은 포함하지 않는다. private env는 소유자 확인 후 0600으로 제한하고 출력은 원자적으로 교체한다. 두 제공자 간 수동 전환 실험을 별도로 승인한 경우에만 두 키를 채운 뒤 `--allow-switching`을 추가한다. Google과 다른 제공자의 동일 애플리케이션 사용 관련 약관은 미해결이다.

NAVER는 NCP Maps Application의 **Dynamic Map** 사용과 Web 서비스 URL 등록이 필요하다. SDK는 `ncpKeyId`로 로드하며 `ncpClientId` 구형 방식을 사용하지 않는다. 콘솔의 실제 서비스 URL 허용 규칙을 확인하고 이 lab에 사용할 주소만 등록한다. NCP 세부 콘솔 가이드는 이번 fetch가 HTTP 403이므로 포트/도메인 정규화 규칙은 확정하지 않았다.

Google은 Maps JavaScript API 활성화, billing 설정 및 **website/HTTP referrer + API restriction**을 적용한다. 실제 접속 origin에 맞춰 제한하고 Maps JavaScript API만 허용한다. 예시 lab 주소는 `http://<HA 호스트>:18123/*`이며 콘솔 검증 규칙을 확인한다. 키는 브라우저에 공개되므로 referrer 제한 없는 키/서버 공용 키를 넣지 않는다. 과금은 provider의 실제 요금표·프로젝트 사용량에 따른다. 무료 또는 비용 상한을 보장하지 않는다. 제공자 간 전환은 새 지도 인스턴스 로드를 발생시킬 수 있어 과금이 늘 수 있다.

### 클러스터링을 먼저 명시적으로 해제

hui-map-card의 클러스터링 설정 키는 `cluster`이며 기본값은 true이다 (frontend 20260930.3 `hui-map-card.ts`: `this._config.cluster ?? true`). `cluster_markers`는 이 버전의 map card가 읽지 않는다. 이 어댑터는 HA의 grouping/cluster icon contract를 구현하지 않으므로 **클러스터링 요청 시 기본 HA 지도만 유지하고 SDK를 로드하지 않는다**. 실제 지도 테스트에서는 `/map/0` map card에 `cluster: false`를 명시한다. 카드의 그룹화 토글 버튼으로 클러스터링을 켜면 기본 지도 안전 모드로 전환되고, 끈 뒤에는 `선택 지도 재개`로 다시 켜야 한다.

```yaml
type: map
entities:
  - zone.home
cluster: false
```

실측(2026-10-11, lab): NAVER는 `/map/0`에서 렌더링·복구·재개 확인. Google은 `ApiTargetBlockedMapError`로 인증 실패 후 기본 지도로 자동 복구됨 — 키의 API 제한에 Maps JavaScript API가 포함되지 않은 상태.

설정 생성 후 `/map/0`을 캐시 무시 새로고침한다. 기존 mount가 hook 설치보다 먼저 시작하면 대시보드를 나갔다 다시 들어가 map card를 remount한다. 최초 instance 전에 설치되었다고 가정하지 않는다. 필요 시 bootstrap의 `whenDefined`/hass-version polling 결과를 확인한다. 현재 extra_module 등록은 이미 살아 있으므로 이 파일 변경만으로 컨테이너 재시작은 요구되지 않는다.

## 브라우저 검증 체크리스트 (parent의 기존 로그인 세션에서)

HA 인증/저장소를 읽지 않고 다음 결과만 확인한다:

```js
await window.haMapExtensionReady;
window.haMapExtension.diagnostics();
// mode: official, provider: naver/google, routers[].provider가 선택한 제공자
// pending: 0, safeMode: false; diagnostics에는 키나 좌표/토큰이 없다.
await window.haMapExtension.recover(); // 기본 지도 안전 모드
await window.haMapExtension.resume('naver'); // 키/opt-in된 제공자만 가능
```

카드 오른쪽 위의 `기본 지도 복구`/`선택 지도 재개` 버튼으로 동일하게 제어할 수 있다. 로고/attribution이 있는 아래쪽은 건드리지 않는다. 실제 지리 타일, marker 클릭으로 more-info, 앵커와 위치, meter-radius 정확도/zone, path segment와 point title, pan/zoom/bounds, 다른 dashboard와 zone editor의 native 유지, DOM teardown을 직접 검증해야 한다. SDK `tilesloaded`만으로 올바른 인증/지도 내용까지 증명된 것으로 간주하지 않는다.

SDK timeout/인증 실패/첫 타일 프레임 실패는 안전 모드 native로 복구한다. 기존 native가 건강하면 재초기화하지 않고 유지한다. SDK가 commit된 뒤 실패하면 원래 factory에서 fresh native를 생성해 overlay records를 재생한다. native 원래 renderer마저 실패하면 `native-recovery-failed`로 표시하며 성공을 꾸미지 않는다. 네트워크 script 로드 실패나 키 변경은 전체 reload 후 다시 시도한다 (loader는 같은 document의 단일 키 소유권을 유지한다).

## Router/SDK 세부 사항

- HA `[latitude, longitude]` → provider LatLng 변환; center/zoom/view/bounds, resize/contains 지원.
- 같은 marker DOM을 SDK OverlayView에 재배치해 HA listener를 유지하고 wrapper에 anchor/size/접근성·pointer 설정을 적용한다. NAVER의 pane은 `overlayImage`, Google은 `overlayMouseTarget`이다.
- Circle의 radius는 meter. marker GPS decoration의 수명은 marker와 같다. HA의 이미 분할된 path segments 및 point markers를 재생한다. point tooltip HTML은 caller-escaped HTML을 plain browser title로 표시한다 (native popup 모양을 재현하지 않는다).
- stable logical circle/path handles의 update/remove는 전환 중에도 최신 값을 보존한다. stale loader/init와 destroy/timeout은 generation 취소 및 늦은 candidate destroy로 처리한다. candidate는 commit 전 숨겨 건강한 native를 가리지 않는다. 같은 provider 재선택은 인스턴스를 재생성하지 않는다.
- HA tile-proxy token은 native 엔진에만 전달된다. SDK 초기화 옵션은 center/zoom/controls/events만 구성한다. SDK 사용 시 선택한 제공자에는 지도 중심/viewport, 타일 요청과 브라우저 네트워크 정보가 전달되고 marker/circle/path 좌표가 해당 SDK 런타임에 들어간다. HA 인증 토큰/전체 hass/state 객체를 보내지는 않는다. SDK 내부 telemetry의 완전한 비전송은 보장하지 않는다.
- HA MapLibre 스타일/강제 dark 테마, native popup HTML 디자인, 세부 imperative animation semantics, 임의 scale unit/국제 저줌 NAVER coverage는 provider equivalent가 아니다. 공식 기본 cartography를 유지하며 원본 logo/attribution을 숨기지 않는다.
- 편집/drag API는 구현하지 않고 편집 화면 자체를 소유하지 않는다. 클러스터링은 native fail-close.
- 국경/대한민국/독도 자동 판정 polygon은 추가하지 않았다. 정확한 영토 경계라 주장하는 사각형/샘플 polygon을 넣지 않는다. 향후 자동 국가 선택은 licensed public boundary 또는 사용자가 검증한 local GeoJSON과 근거를 별도 추가한다. 현재는 명시적 제공자 선택/전환이다.

## 롤백

```sh
cd <저장소 루트>
python3 generate-provider-config.py --provider native
# /map/0 캐시 무시 새로고침
```

즉시 복구는 `await window.haMapExtension.recover()`이다. 완전 hook 제거는 `window.haMapExtension.uninstall()` 후 reload한다. 이후 third-party patch가 descriptor를 교체했다면 uninstall이 덮어쓰지 않는다. 영구적으로 제거하려면 lab `configuration.yaml`의 extra_module_url 등록만 제거하고 **이 lab 컨테이너만 승인받아 재시작**한다.

## 재현 가능한 검증

```sh
node --test test/*.test.mjs
python3 -m unittest discover -s test -p '*_test.py' -v
python3 verify-dashboard-deployment.py
node --check config/www/ha-map-sdk.mjs
node --check config/www/ha-map-router.mjs
node --check config/www/ha-map-controls.mjs
node --check config/www/ha-map-extension.mjs
```

Node fake tests는 인증·과금이나 실제 SDK render 증거가 아니다. deployment 검증은 정확한 lab의 HTML preload pin/extra-module 등록과 HTTP served 파일이 host artifact와 일치하는지만 검증한다. 로그인 브라우저의 실지도 SDK 검증과는 별도 gate이다.

## 공식 근거 (개발 시 원문 fetch, 요금 수치는 고정하지 않음)

- HA MapEngine pinned source: https://github.com/home-assistant/frontend/blob/20260930.3/src/common/map/map-engine.ts
- NAVER SDK loader/auth: https://navermaps.github.io/maps.js.ncp/docs/tutorial-2-Getting-Started.html
- NAVER Application / Dynamic Map: https://navermaps.github.io/maps.js.ncp/docs/tutorial-1-Getting-Client-ID.html
- NAVER OverlayView: https://navermaps.github.io/maps.js.ncp/docs/naver.maps.OverlayView.html
- NAVER panes/events/bounds: https://navermaps.github.io/maps.js.ncp/docs/naver.maps.Map.html
- NAVER Maps product/pricing entry: https://www.ncloud.com/product/applicationService/maps
- Google SDK loader: https://developers.google.com/maps/documentation/javascript/load-maps-js-api
- Google OverlayView: https://developers.google.com/maps/documentation/javascript/customoverlays
- Google key restrictions: https://developers.google.com/maps/api-security-best-practices
- Google usage/billing: https://developers.google.com/maps/documentation/javascript/usage-and-billing
- Google attribution/policies: https://developers.google.com/maps/documentation/javascript/policies
- Google service-specific terms (적용 계약/지역/사용 형태의 개별 검토 필요): https://cloud.google.com/maps-platform/terms/maps-service-terms

법률 자문/production 허가 결론이 아니다. 공식 문서에 있는 승인·표시·billing 요구와 다중 provider 구성의 적용 조건은 실제 배포 전에 다시 확인한다.
