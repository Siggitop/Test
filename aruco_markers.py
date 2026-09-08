import cv2
import numpy as np
import json
from pathlib import Path


# ============================================================
# KONFIGURATION
# ============================================================

CALIB_FILE = "camera_calib.npz"
IMAGE_FILE = "zwei_marker.jpg"

# Reale Kantenlänge des ArUco-Markers in Metern
MARKER_LENGTH = 0.0705

# ArUco Dictionary
ARUCO_DICT = cv2.aruco.DICT_6X6_250

# Ausgabe
OUTPUT_JSON = "markers.json"
OUTPUT_IMAGE = "ergebnis.jpg"


# ============================================================
# 1. KALIBRIERUNG LADEN
# ============================================================

calib = np.load(CALIB_FILE)

K = calib["K"]
dist = calib["dist"]

print("Kamerakalibrierung geladen.")
print("K =")
print(K)
print("dist =", dist.ravel())


# ============================================================
# 2. BILD LADEN
# ============================================================

image = cv2.imread(IMAGE_FILE)

if image is None:
    raise RuntimeError(f"Bild konnte nicht geladen werden: {IMAGE_FILE}")

gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)


# ============================================================
# 3. ARUCO MARKER ERKENNEN
# ============================================================

aruco_dict = cv2.aruco.getPredefinedDictionary(ARUCO_DICT)
parameters = cv2.aruco.DetectorParameters()

detector = cv2.aruco.ArucoDetector(
    aruco_dict,
    parameters
)

corners, ids, rejected = detector.detectMarkers(gray)

if ids is None or len(ids) < 2:
    raise RuntimeError(
        f"Es wurden nur {0 if ids is None else len(ids)} Marker erkannt. "
        "Es werden mindestens zwei benötigt."
    )

print()
print(f"{len(ids)} Marker erkannt:")
print(ids.flatten().tolist())


# ============================================================
# 4. MARKER-POSE BESTIMMEN
# ============================================================

def get_marker_pose(corner, marker_length, K, dist):
    """
    Liefert Rotation und Translation eines einzelnen Markers.

    Das Marker-Koordinatensystem entspricht:
        Ursprung = Marker-Mitte
        X = lokale Marker-X-Achse
        Y = lokale Marker-Y-Achse
        Z = senkrecht aus der Markerfläche heraus
    """

    half = marker_length / 2.0

    obj_points = np.array([
        [-half,  half, 0],
        [ half,  half, 0],
        [ half, -half, 0],
        [-half, -half, 0],
    ], dtype=np.float32)

    # IPPE_SQUARE ist für quadratische Marker gut geeignet.
    ok, rvec, tvec = cv2.solvePnP(
        obj_points,
        corner[0],
        K,
        dist,
        flags=cv2.SOLVEPNP_IPPE_SQUARE
    )

    if not ok:
        raise RuntimeError("solvePnP konnte die Markerpose nicht bestimmen.")

    R, _ = cv2.Rodrigues(rvec)

    return rvec, tvec, R


poses = {}

for i, marker_id in enumerate(ids.flatten()):

    rvec, tvec, R = get_marker_pose(
        corners[i],
        MARKER_LENGTH,
        K,
        dist
    )

    marker_id = int(marker_id)

    poses[marker_id] = {
        "rvec": rvec,
        "tvec": tvec,
        "R": R
    }


# ============================================================
# 5. ZWEI MARKER AUSWÄHLEN
# ============================================================

marker_ids = sorted(poses.keys())

id_a = marker_ids[0]
id_b = marker_ids[1]

pose_a = poses[id_a]
pose_b = poses[id_b]

print()
print(f"Verwendete Marker:")
print(f"  Marker A = {id_a}")
print(f"  Marker B = {id_b}")


# ============================================================
# 6. POSITIONEN UND ACHSEN BEIDER MARKER (KAMERAKOORDINATEN)
# ============================================================

# Beide Marker stammen aus demselben Foto und liegen damit
# bereits im selben, konsistenten Koordinatensystem: dem der
# Kamera. Eine Umrechnung in das Koordinatensystem eines der
# beiden Marker ist hier nicht nötig und würde nur eine
# zusätzliche, fehleranfällige Transformation einführen.
#
# tvec = Position des Marker-Ursprungs in Kamerakoordinaten
# R    = Spalten 0/1/2 = lokale X-/Y-/Z-Achse des Markers,
#        ausgedrückt in Kamerakoordinaten

marker_a_position = pose_a["tvec"].flatten().astype(float)
marker_b_position = pose_b["tvec"].flatten().astype(float)

marker_a_x_axis = pose_a["R"][:, 0].astype(float)
marker_a_y_axis = pose_a["R"][:, 1].astype(float)
marker_a_z_axis = pose_a["R"][:, 2].astype(float)

marker_b_x_axis = pose_b["R"][:, 0].astype(float)
marker_b_y_axis = pose_b["R"][:, 1].astype(float)
marker_b_z_axis = pose_b["R"][:, 2].astype(float)

# Normieren zur Sicherheit
marker_a_x_axis /= np.linalg.norm(marker_a_x_axis)
marker_a_y_axis /= np.linalg.norm(marker_a_y_axis)
marker_a_z_axis /= np.linalg.norm(marker_a_z_axis)

marker_b_x_axis /= np.linalg.norm(marker_b_x_axis)
marker_b_y_axis /= np.linalg.norm(marker_b_y_axis)
marker_b_z_axis /= np.linalg.norm(marker_b_z_axis)


# ============================================================
# 7. DISTANZ ZWISCHEN A UND B
# ============================================================

diff = marker_b_position - marker_a_position

distance_m = np.linalg.norm(diff)
distance_mm = distance_m * 1000.0

print()
print("Relative Position B bezüglich A:")
print(
    "  X = %.1f mm" % (diff[0] * 1000)
)
print(
    "  Y = %.1f mm" % (diff[1] * 1000)
)
print(
    "  Z = %.1f mm" % (diff[2] * 1000)
)
print(
    "  Abstand = %.1f mm" % distance_mm
)

print()
print("Marker A X-Achse:")
print(marker_a_x_axis)
print("Marker A Y-Achse:")
print(marker_a_y_axis)
print("Marker A Z-Achse:")
print(marker_a_z_axis)

print()
print("Marker B X-Achse:")
print(marker_b_x_axis)
print("Marker B Y-Achse:")
print(marker_b_y_axis)
print("Marker B Z-Achse:")
print(marker_b_z_axis)


# ============================================================
# 8. JSON ERZEUGEN
# ============================================================

def vec_to_json(v):
    return {
        "x": float(v[0]),
        "y": float(v[1]),
        "z": float(v[2])
    }


data = {
    "coordinateSystem": {
        "origin": "camera",
        "unit": "meter",
        "description": (
            "Ursprung ist die Kamera zum Aufnahmezeitpunkt. "
            "Alle Positionen und Achsen von Marker A und B "
            "sind in Kamerakoordinaten angegeben."
        )
    },

    "markerA": {
        "id": id_a,

        "position": vec_to_json(
            marker_a_position
        ),

        "xAxis": vec_to_json(
            marker_a_x_axis
        ),

        "yAxis": vec_to_json(
            marker_a_y_axis
        ),

        "zAxis": vec_to_json(
            marker_a_z_axis
        )
    },

    "markerB": {
        "id": id_b,

        "position": vec_to_json(
            marker_b_position
        ),

        "xAxis": vec_to_json(
            marker_b_x_axis
        ),

        "yAxis": vec_to_json(
            marker_b_y_axis
        ),

        "zAxis": vec_to_json(
            marker_b_z_axis
        )
    }
}


with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2)


print()
print(f"{OUTPUT_JSON} geschrieben.")


# ============================================================
# 9. VISUALISIERUNG
# ============================================================

cv2.aruco.drawDetectedMarkers(
    image,
    corners,
    ids
)

for marker_id in marker_ids:

    pose = poses[marker_id]

    cv2.drawFrameAxes(
        image,
        K,
        dist,
        pose["rvec"],
        pose["tvec"],
        MARKER_LENGTH * 0.75
    )


cv2.imwrite(
    OUTPUT_IMAGE,
    image
)

print(f"{OUTPUT_IMAGE} geschrieben.")


# ============================================================
# 10. ZUSAMMENFASSUNG
# ============================================================

print()
print("==============================================")
print(" ARUCO ROHRANSCHLÜSSE")
print("==============================================")
print(f"Marker A : {id_a}")
print(f"Marker B : {id_b}")
print()
print(
    "A Position : "
    f"{marker_a_position}"
)
print(
    "A X-Achse  : "
    f"{marker_a_x_axis}"
)
print(
    "A Y-Achse  : "
    f"{marker_a_y_axis}"
)
print(
    "A Z-Achse  : "
    f"{marker_a_z_axis}"
)
print()
print(
    "B Position : "
    f"{marker_b_position}"
)
print(
    "B X-Achse  : "
    f"{marker_b_x_axis}"
)
print(
    "B Y-Achse  : "
    f"{marker_b_y_axis}"
)
print(
    "B Z-Achse  : "
    f"{marker_b_z_axis}"
)
print()
print(f"Abstand    : {distance_mm:.1f} mm")
print()
print(f"JSON       : {OUTPUT_JSON}")
print(f"Bild       : {OUTPUT_IMAGE}")
print("==============================================")
