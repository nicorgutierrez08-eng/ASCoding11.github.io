"""
Project Daedalus: the case, the button caps and the board outline, as one parametric model.

Run with CadQuery 2.x (pip install cadquery):

    python daedalus_case.py            # writes the STL and STEP files, board.dxf, layout.json and template.svg
                                       # next to this file

Every size is in millimetres and lives in the P dictionary below. The same numbers place the parts on the
circuit board (board.dxf, layout.json) and cut the holes in the case, so the two always agree: change a
number here, run the script again, and both the case and the board drawing move together.

Axes, looking at the front of the controller as you hold it:
    X  left to right, 0 in the middle
    Y  bottom to top, 0 in the middle of the main bar (the grips hang below)
    Z  back to front, 0 = the front face of the circuit board (the side with the parts and the stick)

STATUS: version 3. Drawn from datasheets and estimates, not yet printed or fitted. The values marked MEASURE
must be checked against the real parts with calipers before a full case is printed. Print coupon.stl first.

    version 1   a plain slab with bevelled edges, 134 x 80 x 22.7 mm
    version 2   the same inside, with a curved outline and rounded edges, 140 x 85 x 22.7 mm (kept in v2/)
    version 3   this one: smaller (125 x 78 x 20.9 mm) and cleaner. The board is 14 mm narrower, the radio
                module has moved to the bottom edge so the USB-C socket sits dead centre at the top, the
                shoulders sweep round in one curve with the shoulder buttons following it, and Select,
                Start, Home and the light form a small diamond that echoes the face buttons.

Both faces stay flat and print against the plate, which gives the cleanest surface a filament printer can
make; the edges start with a short 45-degree flat and then curve into the wall, so nothing needs supports.

Where the numbers come from (read November 2026):
    stick        YTL YHE-YG13-013 / YTMR-YG13-006 datasheets (hole pattern, 13.1 mm frame, 19.45 mm shaft height)
    radio        ESP32-C6-WROOM-1 datasheet (18.0 x 25.5 x 3.1 mm, antenna in the top 6 mm)
    USB-C        TYPE-C-31-M-12 datasheet (8.94 x 7.35 x 3.26 mm, mouth about 0.5 mm past the board edge)
    slide switch MSK12C02 datasheet (8.0 x 2.8 x 1.4 mm, knob out of the side, 1.6 mm travel)
    shoulders    SHOU HAN TS3819ZJ datasheet (3.9 x 2.9 x 1.6 mm, push-button sticks out 0.85 mm)
    small switch XUNPU TS-1088-AR02016 datasheet (3.9 x 3.0 mm, 2.0 mm tall)
    face buttons spacing of the contacts on an open-hardware SNES controller board
                 (codeberg.org/taylor-madeak/oshw-snes-controller-pcb, CC BY-SA 4.0): 27.0 mm left to right,
                 21.0 mm top to bottom. Dome height and cap size are NOT from a datasheet: measure your pad.
    battery      603450 cell datasheet (6 x 34 x 52 mm)
"""

import json
import math
import os

import cadquery as cq

P = {
    # ---- body ---------------------------------------------------------------------------------------------
    "bar_h": 54.0,              # height of the main bar; its top edge is at Y = bar_h / 2
    # The outline seen from the front: the corners of the right-hand half, going down the right side and
    # round the grip, each with the radius it is rounded to. The left half is the mirror image.
    "outline_right": [
        (59.0, 27.0, 22.0),     # shoulder: one long sweep from the top edge into the side
        (62.5, -24.0, 26.0),    # widest point, at the heel of the hand
        (55.0, -51.0, 9.0),     # outer side of the grip's tip
        (38.5, -49.0, 9.0),     # inner side of the grip's tip
        (26.0, -27.0, 17.0),    # the arch where the grip meets the underside of the bar
    ],
    "wall": 2.0,                # wall thickness
    "front_gap": 8.5,           # board front face to the inside of the front shell        MEASURE against the stick
    "back_gap": 8.0,            # board back face to the inside of the back shell: a 6 mm battery, 0.6 mm of tape
                                #   under it, and 1.4 mm above it so it clears the USB-C socket's solder legs
    # Outside edges: (flat, radius). The edge starts with a 45-degree flat this wide where it meets the print
    # bed, then curves into the wall with this radius. A plain round would overhang too steeply to print.
    "edge_front": (2.0, 5.0),
    "edge_back": (3.2, 7.5),    # the palm side, so rounder
    "edge_front_in": 1.2,       # matching bevels inside, which keep the wall an even thickness round the edge
    "edge_back_in": 2.4,
    "hole_ease": 0.5,           # small bevel round the stick and button holes, so their rims are not sharp
    "fit": 0.2,                 # clearance between the two shells' lip and groove

    # ---- circuit board ------------------------------------------------------------------------------------
    "pcb_w": 108.0,
    "pcb_h": 46.0,
    "pcb_t": 1.2,
    "pcb_top_y": 24.6,          # Y of the board's top edge (0.4 mm inside the case's inner wall)
    "pcb_clear": 0.4,           # gap between the board's edge and the inside of the case; the board's top
                                #   corners follow the case's curve at this distance
    "pcb_corner_r": 2.0,        # bottom corners
    "pcb_hole_d": 2.2,          # four mounting holes, also the four main case screws
    "pcb_holes": [(-50.5, 12.0), (50.5, 12.0), (-50.5, -17.0), (50.5, -17.0)],
    "battery_notch": (-33.0, 6.0, 3.0),  # centre X, width, depth of the notch in the bottom edge for the battery lead
    "antenna_notch": (0.0, 20.0, 6.0),   # centre X, width, depth of the cut-out in the bottom edge under the antenna

    # ---- where the parts sit on the board (X, Y of each part's centre) ------------------------------------
    "stick_xy": (-30.0, -2.0),
    "stick_open_d": 25.0,       # hole in the front shell around the stick (clears every part of the module)
    "stick_collar_h": 2.0,      # a ring inside the shell that thickens the rim of that hole, so knocks on the stick
    "stick_collar_w": 3.0,      #   are taken by the case
    "face_xy": (30.0, -2.0),    # centre of the four face buttons
    "face_pitch_x": 13.5,       # centre of the diamond to the left and right buttons      MEASURE on the rubber pad
    "face_pitch_y": 10.5,       # centre of the diamond to the top and bottom buttons      MEASURE (and check the pad is not tilted)
    "face_contact_d": 5.3,      # diameter of each gold contact pattern on the board
    "face_cap_d": 10.6,         # diameter of a face button cap                             MEASURE to suit the pad's domes
    "face_dome_top": 5.2,       # height of the top of an unpressed rubber dome above the board   MEASURE
    "face_proud": 2.6,          # how far a face button stands above the front face
    # Select, Start, Home and the status light make a small diamond in the middle, under the USB-C socket
    "select_xy": (-8.0, 12.4),
    "start_xy": (8.0, 12.4),
    "home_xy": (0.0, 8.4),
    "led_xy": (0.0, 16.4),
    "boot_xy": (14.0, -18.0),
    "select_cap_d": 5.0,        # Select and Start caps (round)
    "home_cap_d": 6.0,
    "tact_top": 2.0,            # height of the top of the small push switches above the board
    "small_proud": 1.2,
    "module_box": (-9.0, -21.4, 18.0, 25.5),  # radio module: left X, bottom Y, width, height (antenna at the BOTTOM edge)
    "usb_x": 0.0,               # centre of the USB-C socket on the top edge
    "usb_open": (9.4, 3.6),     # opening for the plug: width, height
    "usb_z": 1.65,              # centre of the socket's mouth above the board
    "usb_recess": (13.0, 6.6, 1.4),   # shallow pocket round the opening so a cable's boot seats: w, h, depth
    "charge_led_x": 9.5,        # light hole in the top wall for the red / green charge lights
    "switch_x": -14.0,          # centre of the slide switch on the top edge
    "switch_slot": (4.6, 1.8),  # slot for its knob: width (knob 1.3 + travel 1.6 + clearance), height
    "switch_z": 0.7,            # centre of the knob above the board
    "switch_recess": (9.0, 4.0, 1.4),   # pocket round the slot so a fingernail can reach the knob: w, h, depth
    "jst_xy": (-15.5, -16.5),   # battery socket, side entry, its mouth facing LEFT; the plug lies along the bottom edge
    # shoulder buttons: side-facing switches on the top edge, pressed by sliding plungers whose outer ends
    # follow the curve of the shoulder
    "l1_x": -38.5, "l2_x": -25.5, "r1_x": 38.5, "r2_x": 25.5,
    "shoulder_w1": 12.0,        # width of the L1 / R1 plungers
    "shoulder_w2": 10.0,        # width of the L2 / R2 plungers
    "shoulder_h": 5.0,          # their height (front to back)
    "shoulder_z0": 0.2,         # bottom of a plunger above the board (the switch's push-button must fall inside
                                #   shoulder_z0 .. shoulder_z0 + shoulder_h)                   MEASURE
    "shoulder_body_top": 2.0,   # the plunger's catch passes over the switch's body: its height above the board   MEASURE
    "shoulder_proud": 2.2,      # how far a plunger stands out from the case
    "shoulder_tip_y": 25.45,    # Y of the switch's push-button tip when not pressed (body flush with the board edge)
    "plunger_gap": 0.25,        # clearance all round a plunger or button cap in its hole

    # ---- screws -------------------------------------------------------------------------------------------
    "grip_screws": [(-46.0, -40.0), (46.0, -40.0)],
    "insert_d": 3.2,            # hole for an M2 x 3 brass heat-set insert (the insert itself is 3.6 mm across)
    "insert_depth": 4.5,
    "boss_d": 6.4,
    "screw_d": 2.4,             # clearance hole for an M2 screw
    "head_d": 4.4,              # counterbore for the screw head
    "seat_below_pcb": 3.5,      # plastic between the board's back face and the screw head's seat (M2 x 8 screws)

    # ---- battery ------------------------------------------------------------------------------------------
    "battery_xy": (8.5, 3.5),
    "battery_box": (54.0, 36.0),   # pocket for a 603450 cell: 52 x 34.5 plus 1 mm each way      MEASURE
    "battery_rib_h": 4.0,
    "battery_rib_t": 1.2,
    # posts on the back shell that hold the board up behind the stick and the face buttons, so pressing
    # them does not bend it. Keep these spots on the back of the board free of solder joints.
    "back_supports": [(38.5, -2.0), (-30.0, 12.0), (-43.0, -14.0)],
}

HERE = os.path.dirname(os.path.abspath(__file__))


# ------------------------------------------------------------------------------------------------ helpers
def z_levels(p):
    """The heights everything else is built from."""
    front_in = p["front_gap"]
    front_out = front_in + p["wall"]
    pcb_back = -p["pcb_t"]
    back_in = pcb_back - p["back_gap"]
    back_out = back_in - p["wall"]
    return {"front_in": front_in, "front_out": front_out, "split": pcb_back, "back_in": back_in, "back_out": back_out}


def outline_corners(p):
    """All the outline's corners in order round the shape, as (x, y, radius)."""
    right = p["outline_right"]
    left = [(-x, y, r) for (x, y, r) in reversed(right)]
    return right + left


def outline_size(p):
    xs = [c[0] for c in outline_corners(p)]
    ys = [c[1] for c in outline_corners(p)]
    return max(xs) - min(xs), max(ys) - min(ys)


def rounded_polygon(corners):
    """A closed outline through the given corners, each rounded to its own radius: straight lines joined by
    arcs that meet them smoothly."""
    n = len(corners)
    cuts = []
    for i, (x, y, r) in enumerate(corners):
        px, py, _ = corners[i - 1]
        nx, ny, _ = corners[(i + 1) % n]
        ux, uy = px - x, py - y
        vx, vy = nx - x, ny - y
        lu, lv = math.hypot(ux, uy), math.hypot(vx, vy)
        ux, uy, vx, vy = ux / lu, uy / lu, vx / lv, vy / lv
        half = math.acos(max(-1.0, min(1.0, ux * vx + uy * vy))) / 2      # half the angle at this corner
        t = r / math.tan(half)                                            # how far along each side the arc starts
        bx, by = ux + vx, uy + vy
        lb = math.hypot(bx, by)
        bx, by = bx / lb, by / lb
        k = r / math.sin(half) - r                                        # corner to the middle of the arc
        cuts.append(((x + ux * t, y + uy * t), (x + bx * k, y + by * k), (x + vx * t, y + vy * t), t, lu))
    for i in range(n):
        assert cuts[i][3] + cuts[i - 1][3] <= cuts[i][4] + 1e-6, "outline: the radii at corners %d and %d overlap" % (i - 1, i)
    w = cq.Workplane("XY").moveTo(*cuts[0][2])
    for i in range(1, n + 1):
        a, mid, b, _, _ = cuts[i % n]
        w = w.lineTo(*a).threePointArc(mid, b)
    return w.close()


def outline_wire(p, inset=0.0):
    """The rounded outline as a closed curve at Z = 0, moved inwards by inset (a true parallel offset, so a
    wall between two of these curves has the same thickness all the way round)."""
    wire = rounded_polygon(outline_corners(p)).val()
    if inset:
        wire = wire.offset2D(-inset)[0]
    return wire


def prism(p, z0, z1, inset=0.0):
    """The outline pulled from z0 to z1."""
    return cq.Workplane("XY").add(outline_wire(p, inset)).toPending().extrude(z1 - z0).translate((0, 0, z0))


def ease(x, y, z_face, d, e):
    """A small bevel round the outside rim of a round hole of diameter d in the front face."""
    cone = cq.Solid.makeCone(d / 2, d / 2 + e, e, cq.Vector(x, y, z_face - e), cq.Vector(0, 0, 1))
    return cq.Workplane("XY").add(cone)


def half_space(z0, z1):
    """A slab bigger than the whole case, from z0 to z1."""
    return box(0, 0, z0, z1, 400, 400)


def soft_edge(solid, face, flat, radius):
    """Round the edge of the given face (">Z" or "<Z"): a 45-degree flat, then a curve into the wall."""
    zf = solid.faces(face).val().Center().z
    solid = solid.faces(face).edges().chamfer(flat)
    if radius:
        zc = zf - flat if face == ">Z" else zf + flat
        ring = cq.selectors.BoxSelector((-400, -400, zc - 0.01), (400, 400, zc + 0.01))
        solid = solid.edges(ring).fillet(radius)
    return solid


def cyl(x, y, z0, z1, d):
    return cq.Workplane("XY").workplane(offset=z0).center(x, y).circle(d / 2).extrude(z1 - z0)


def box(x, y, z0, z1, w, h):
    return cq.Workplane("XY").workplane(offset=z0).center(x, y).rect(w, h).extrude(z1 - z0)


def slot(x, y, z0, z1, length, width):
    return cq.Workplane("XY").workplane(offset=z0).center(x, y).slot2D(length, width).extrude(z1 - z0)


def top_wall_cut(p, x, zc, w, h, depth=None):
    """A rectangular hole through the top wall, centred at X = x and Z = zc."""
    y_in = p["bar_h"] / 2 - p["wall"]
    d = p["wall"] + 2.0 if depth is None else depth
    y0 = y_in - 1.0 if depth is None else p["bar_h"] / 2 - depth
    return cq.Workplane("XY").workplane(offset=zc - h / 2).center(x, y0 + d / 2).rect(w, d).extrude(h)


def face_centres(p):
    cx, cy = p["face_xy"]
    rx, ry = p["face_pitch_x"], p["face_pitch_y"]
    return {"north": (cx, cy + ry), "east": (cx + rx, cy), "south": (cx, cy - ry), "west": (cx - rx, cy)}


def shoulders(p):
    return [("L1", p["l1_x"], p["shoulder_w1"]), ("L2", p["l2_x"], p["shoulder_w2"]),
            ("R2", p["r2_x"], p["shoulder_w2"]), ("R1", p["r1_x"], p["shoulder_w1"])]


# ------------------------------------------------------------------------------------------------ shells
LIP_H, LIP_T = 1.2, 1.0     # the back shell's lip: how far it stands up into the front shell, and its thickness
LIP_STOP = 7.0              # the lip and its groove stop this far below the top edge, so the wall under the USB-C
                            #   opening and the shoulder slots keeps its full thickness


def lip_zone(p, z0, z1):
    """Everything except a strip along the top edge."""
    top = p["bar_h"] / 2 - LIP_STOP
    bottom = -200.0
    return box(0, (top + bottom) / 2, z0, z1, 400, top - bottom)


def outer_solid(p):
    z = z_levels(p)
    body = prism(p, z["back_out"], z["front_out"])
    body = soft_edge(body, ">Z", *p["edge_front"])
    body = soft_edge(body, "<Z", *p["edge_back"])
    return body


def cavity(p):
    z = z_levels(p)
    hollow = prism(p, z["back_in"], z["front_in"], inset=p["wall"])
    hollow = hollow.faces(">Z").edges().chamfer(p["edge_front_in"])
    hollow = hollow.faces("<Z").edges().chamfer(p["edge_back_in"])
    return hollow


def front_shell(p):
    z = z_levels(p)
    shell = outer_solid(p).intersect(half_space(z["split"], z["front_out"] + 1)).cut(cavity(p))

    # groove round the inside of the rim that the back shell's lip slides into
    groove = prism(p, z["split"], z["split"] + LIP_H + 0.3, inset=p["wall"] - LIP_T - p["fit"])
    shell = shell.cut(groove.intersect(lip_zone(p, z["split"] - 1, z["split"] + LIP_H + 1)))

    # stick: opening and raised collar
    sx, sy = p["stick_xy"]
    collar_od = p["stick_open_d"] + 2 * p["stick_collar_w"]
    shell = shell.union(cyl(sx, sy, z["front_in"] - p["stick_collar_h"], z["front_in"] + 0.5, collar_od))
    shell = shell.cut(cyl(sx, sy, z["front_in"] - p["stick_collar_h"] - 1, z["front_out"] + 1, p["stick_open_d"]))

    # face buttons, Select, Start, Home, status light
    g = p["plunger_gap"]
    for (x, y) in face_centres(p).values():
        shell = shell.cut(cyl(x, y, z["front_in"] - 1, z["front_out"] + 1, p["face_cap_d"] + 2 * g))
        # a small rib beside each hole: the flat on the button's base runs against it, so the button cannot turn
        rib_x = x + p["face_cap_d"] / 2 + CAP_BASE_EXTRA - 0.6 + g + 0.5
        shell = shell.union(box(rib_x, y, z["front_in"] - 3.0, z["front_in"] + 0.5, 1.0, 6.0))
    for key in ("select_xy", "start_xy"):
        x, y = p[key]
        shell = shell.cut(cyl(x, y, z["front_in"] - 1, z["front_out"] + 1, p["select_cap_d"] + 2 * g))
    hx, hy = p["home_xy"]
    shell = shell.cut(cyl(hx, hy, z["front_in"] - 1, z["front_out"] + 1, p["home_cap_d"] + 2 * g))
    lx, ly = p["led_xy"]
    shell = shell.cut(cyl(lx, ly, z["front_in"] - 1, z["front_out"] + 1, 1.6))
    # (the BOOT switch has no hole: it is only needed if firmware goes badly wrong, and a clean front is
    # worth opening six screws for on that day)

    # ease the rims of the round holes
    e = p["hole_ease"]
    if e:
        shell = shell.cut(ease(sx, sy, z["front_out"], p["stick_open_d"], e))
        for (x, y) in face_centres(p).values():
            shell = shell.cut(ease(x, y, z["front_out"], p["face_cap_d"] + 2 * g, e))
        shell = shell.cut(ease(hx, hy, z["front_out"], p["home_cap_d"] + 2 * g, e))
        for key in ("select_xy", "start_xy"):
            shell = shell.cut(ease(p[key][0], p[key][1], z["front_out"], p["select_cap_d"] + 2 * g, e))

    # top edge: USB-C, charge light, slide switch, four shoulder plungers
    shell = shell.cut(top_wall_cut(p, p["usb_x"], p["usb_z"], *p["usb_open"]))
    # a shallow pocket round the opening, from the rim upwards, so the moulded end of a cable can seat
    rz0 = z["split"]
    shell = shell.cut(top_wall_cut(p, p["usb_x"], rz0 + p["usb_recess"][1] / 2, p["usb_recess"][0], p["usb_recess"][1], depth=p["usb_recess"][2]))
    shell = shell.cut(top_wall_cut(p, p["charge_led_x"], 1.0, 1.8, 1.8))
    shell = shell.cut(top_wall_cut(p, p["switch_x"], p["switch_z"], *p["switch_slot"]))
    shell = shell.cut(top_wall_cut(p, p["switch_x"], p["switch_z"] + 0.6, p["switch_recess"][0], p["switch_recess"][1], depth=p["switch_recess"][2]))
    for _, x, w in shoulders(p):
        # cut from well inside the wall to well outside it, so the slot goes right through a curved shoulder too
        zc = p["shoulder_z0"] + p["shoulder_h"] / 2
        shell = shell.cut(box(x, p["bar_h"] / 2 - 7.0 + 8.0, zc - p["shoulder_h"] / 2 - g, zc + p["shoulder_h"] / 2 + g, w + 2 * g, 16.0))

    # posts: four hold the board, two more sit in the grips. Each takes a brass insert.
    for (x, y) in p["pcb_holes"]:
        shell = shell.union(cyl(x, y, 0, z["front_in"] + 0.5, p["boss_d"]))
        shell = shell.cut(cyl(x, y, -0.1, p["insert_depth"], p["insert_d"]))
    for (x, y) in p["grip_screws"]:
        shell = shell.union(cyl(x, y, z["split"], z["front_in"] + 0.5, p["boss_d"]))
        shell = shell.cut(cyl(x, y, z["split"] - 0.1, z["split"] + p["insert_depth"], p["insert_d"]))
    return shell


def back_shell(p):
    z = z_levels(p)
    shell = outer_solid(p).intersect(half_space(z["back_out"] - 1, z["split"])).cut(cavity(p))

    # lip that slides into the front shell's groove
    lip = prism(p, z["split"] - 0.5, z["split"] + LIP_H, inset=p["wall"] - LIP_T).cut(
        prism(p, z["split"] - 1, z["split"] + LIP_H + 1, inset=p["wall"]))
    shell = shell.union(lip.intersect(lip_zone(p, z["split"] - 2, z["split"] + LIP_H + 2).translate((0, -p["fit"] - 0.3, 0))))

    seat = z["split"] - p["seat_below_pcb"]
    posts = [(x, y, z["split"]) for (x, y) in p["pcb_holes"]] + [(x, y, z["split"]) for (x, y) in p["grip_screws"]]
    for (x, y, top) in posts:
        shell = shell.union(cyl(x, y, z["back_in"] - 0.5, top, p["boss_d"] + 0.8))
    for (x, y, top) in posts:
        shell = shell.cut(cyl(x, y, z["back_out"] - 1, top + 2, p["screw_d"]))
        shell = shell.cut(cyl(x, y, z["back_out"] - 1, seat, p["head_d"]))

    for (x, y) in p["back_supports"]:
        shell = shell.union(cyl(x, y, z["back_in"] - 0.5, z["split"], 4.0))

    # battery pocket: four low walls, with a gap at the top right for the lead
    bx, by = p["battery_xy"]
    bw, bh = p["battery_box"]
    t, h = p["battery_rib_t"], p["battery_rib_h"]
    z0, z1 = z["back_in"] - 0.5, z["back_in"] + h
    ribs = (box(bx, by + bh / 2 + t / 2, z0, z1, bw * 0.6, t)
            .union(box(bx, by - bh / 2 - t / 2, z0, z1, bw * 0.6, t))
            .union(box(bx - bw / 2 - t / 2, by, z0, z1, t, bh * 0.6))
            .union(box(bx + bw / 2 + t / 2, by - bh * 0.15, z0, z1, t, bh * 0.4)))
    return shell.union(ribs)


# ------------------------------------------------------------------------------------------------ small parts
CAP_BASE_EXTRA = 1.2    # how much wider a button's base is than its top, all round
CAP_REST_GAP = 0.3      # gap between a button's base and the inside of the shell when it is not pressed


def face_cap(p):
    """A face button, modelled standing on its base, bottom at Z = 0. Print it this way up: no overhangs.
    A wide base stops it coming out through the hole; one flat on the base stops it turning."""
    z = z_levels(p)
    d = p["face_cap_d"]
    height = z["front_out"] + p["face_proud"] - p["face_dome_top"]
    base_h = z["front_in"] - CAP_REST_GAP - p["face_dome_top"]
    cap = cq.Workplane("XY").circle(d / 2 + CAP_BASE_EXTRA).extrude(base_h)
    cap = cap.cut(box(d / 2 + CAP_BASE_EXTRA, 0, -1, base_h + 1, 1.2, d + 4))          # the flat
    cap = cap.union(cq.Workplane("XY").workplane(offset=base_h).circle(d / 2).extrude(height - base_h))
    cap = cap.faces(">Z").edges().fillet(0.8)
    # a shallow socket underneath that sits over the top of the rubber dome
    cap = cap.cut(cq.Workplane("XY").circle(d / 2 - 1.6).extrude(1.0))
    return cap


def small_cap(p, d):
    """Select, Start or Home: a wide base that reaches down to the push switch, then the narrower round top
    that shows through the shell. Bottom at Z = 0; print it this way up."""
    z = z_levels(p)
    height = z["front_out"] + p["small_proud"] - p["tact_top"]
    base_h = z["front_in"] - CAP_REST_GAP - p["tact_top"]
    base = cq.Workplane("XY").circle(d / 2 + CAP_BASE_EXTRA).extrude(base_h)
    top = cq.Workplane("XY").workplane(offset=base_h).circle(d / 2).extrude(height - base_h)
    return base.union(top).faces(">Z").edges().fillet(0.5)


def plunger(p, x, width, in_place=False):
    """A shoulder button at X = x. It slides through the slot in the top wall. Its lower part stops at the
    switch's push-button; its upper part carries on over the switch's body and ends in a catch that hooks
    behind the wall, so it cannot be pulled out. Its outer end is cut to follow the outline of the case,
    standing shoulder_proud out from it, with its two long edges rounded. With in_place it is returned
    where it sits in the case (for checking); without, standing on end ready to print."""
    z0 = p["shoulder_z0"]
    z1 = z0 + p["shoulder_h"]
    zb = p["shoulder_body_top"]
    y_far = p["bar_h"] / 2 + p["shoulder_proud"] + 6
    y_tip = p["shoulder_tip_y"]
    y_wall = p["bar_h"] / 2 - p["wall"]
    catch_t, catch_h, back = 1.4, 1.6, 0.25           # catch thickness, how far it stands above the slot, gap to the wall
    y_catch0 = y_wall - back - catch_t
    lower = box(x, (y_far + y_tip) / 2, z0, zb, width, y_far - y_tip)
    upper = box(x, (y_far + y_catch0) / 2, zb, z1, width, y_far - y_catch0)
    # the catch is cut to the inside of the wall, so on a curved shoulder it still sits just behind it
    catch = box(x, y_catch0, zb, z1 + catch_h, width, catch_t + 4).intersect(
        prism(p, zb - 1, z1 + catch_h + 1, inset=p["wall"] + back)).intersect(box(x, y_catch0 + 20, zb, z1 + catch_h, width, 40))
    # the shape the outer end is cut to: the case's outline grown by shoulder_proud, with rounded edges
    skin = prism(p, z0, z1, inset=-p["shoulder_proud"])
    skin = skin.faces(">Z").edges().fillet(1.2).faces("<Z").edges().fillet(1.2)
    part = lower.union(upper).intersect(skin).union(catch)
    if in_place:
        return part
    # stand it on one end, the L-shaped side flat against the plate
    return part.translate((-x, -y_catch0, -z0)).rotate((0, 0, 0), (0, 1, 0), 90).translate((0, 0, width / 2))


def coupon(p):
    """A small test piece to print first: one face-button hole, one Select hole, one insert post and the
    USB-C opening, all at the real sizes. Check each against the real part before printing a whole case."""
    z = z_levels(p)
    g = p["plunger_gap"]
    t = p["wall"]
    plate = cq.Workplane("XY").rect(46, 26).extrude(t)
    plate = plate.cut(cyl(-13, 4, -1, t + 1, p["face_cap_d"] + 2 * g))
    plate = plate.cut(cyl(6, 6, -1, t + 1, p["select_cap_d"] + 2 * g))
    plate = plate.union(cyl(16, -5, 0, t + 6, p["boss_d"])).cut(cyl(16, -5, t + 6 - p["insert_depth"], t + 7, p["insert_d"]))
    wall = cq.Workplane("XY").center(-4, -12).rect(24, t).extrude(t + 9)
    usb = cq.Workplane("XY").workplane(offset=t + 4 - p["usb_open"][1] / 2).center(-4, -12).rect(p["usb_open"][0], t + 2).extrude(p["usb_open"][1])
    return plate.union(wall).cut(usb)


# ------------------------------------------------------------------------------------------------ board
def board(p):
    """The circuit board: a rectangle whose top corners are trimmed to follow the inside of the case."""
    y0 = p["pcb_top_y"] - p["pcb_h"]
    yc = p["pcb_top_y"] - p["pcb_h"] / 2
    b = cq.Workplane("XY").workplane(offset=-p["pcb_t"]).center(0, yc).rect(p["pcb_w"], p["pcb_h"]).extrude(p["pcb_t"])
    b = b.edges("|Z").edges("<Y").fillet(p["pcb_corner_r"])
    b = b.intersect(prism(p, -p["pcb_t"] - 1, 1, inset=p["wall"] + p["pcb_clear"]))
    nx, nw, nd = p["battery_notch"]
    b = b.cut(box(nx, y0 + nd / 2 - 0.5, -p["pcb_t"] - 1, 1, nw, nd + 1))
    ax, aw, ad = p["antenna_notch"]
    b = b.cut(box(ax, y0 + ad / 2 - 0.5, -p["pcb_t"] - 1, 1, aw, ad + 1))
    for (x, y) in p["pcb_holes"]:
        b = b.cut(cyl(x, y, -p["pcb_t"] - 1, 1, p["pcb_hole_d"]))
    return b


def board_outline_points(p, x0, y0, step=1.0):
    """The board's edge as a list of points in board coordinates, going once round it (arcs are broken into
    short straight steps). board.dxf has the exact curves; this is for drawing it."""
    from OCP.BRepAdaptor import BRepAdaptor_Curve
    from OCP.BRepTools import BRepTools_WireExplorer
    from OCP.TopAbs import TopAbs_REVERSED

    wire = board(p).faces("<Z").val().outerWire()
    pts = []
    explorer = BRepTools_WireExplorer(wire.wrapped)
    while explorer.More():
        edge = explorer.Current()
        curve = BRepAdaptor_Curve(edge)
        a, b = curve.FirstParameter(), curve.LastParameter()
        n = max(1, int(math.ceil(cq.Edge(edge).Length() / step)))
        ts = [a + (b - a) * i / n for i in range(n)]
        if edge.Orientation() == TopAbs_REVERSED:
            ts = [b - (b - a) * i / n for i in range(n)]
        for t in ts:
            q = curve.Value(t)
            pts.append([round(q.X() - x0, 2), round(q.Y() - y0, 2)])
        explorer.Next()
    return pts


def stick_holes(p, x0, y0):
    """The stick's holes in board coordinates, from the YTL 13-series datasheet (seen from the front, the
    click switch to the left, sensor R2 to the right, sensor R1 below). Hall version: pin 1 GND, 2 OUT, 3 VCC."""
    sx, sy = p["stick_xy"]

    def at(dx, dy, d, name):
        return {"name": name, "x": round(sx + dx - x0, 3), "y": round(sy + dy - y0, 3), "diameter": d}

    holes = [at(dx, dy, 1.2, "frame leg") for dx in (-5.0, 5.0) for dy in (-6.325, 6.325)]
    holes += [at(-2.5, -8.7, 1.0, "R1 pin 1"), at(0.0, -8.7, 1.0, "R1 pin 2"), at(2.5, -8.7, 1.0, "R1 pin 3")]
    holes += [at(8.7, -2.5, 1.0, "R2 pin 1"), at(8.7, 0.0, 1.0, "R2 pin 2"), at(8.7, 2.5, 1.0, "R2 pin 3")]
    holes += [at(-5.65, 3.25, 0.9, "switch S1"), at(-5.65, -3.25, 0.9, "switch S2"),
              at(-10.15, 3.25, 0.9, "switch S3"), at(-10.15, -3.25, 0.9, "switch S4")]
    return holes


def layout(p):
    """Everything someone drawing the circuit board needs, in board coordinates: X from the board's left
    edge, Y up from its bottom edge."""
    x0 = -p["pcb_w"] / 2
    y0 = p["pcb_top_y"] - p["pcb_h"]

    def bc(xy):
        return [round(xy[0] - x0, 2), round(xy[1] - y0, 2)]

    faces = {k: bc(v) for k, v in face_centres(p).items()}
    mx, my, mw, mh = p["module_box"]
    return {
        "units": "mm",
        "case": {"width": outline_size(p)[0], "height": outline_size(p)[1],
                 "thickness": round(z_levels(p)["front_out"] - z_levels(p)["back_out"], 2)},
        "origin": "bottom-left corner of the board, seen from the front (the side with the parts)",
        "board": {"width": p["pcb_w"], "height": p["pcb_h"], "thickness": p["pcb_t"],
                  "corner_radius_bottom": p["pcb_corner_r"],
                  "top_corners": "follow the inside of the case %.1f mm in: use board.dxf for the exact outline" % p["pcb_clear"]},
        "board_outline": board_outline_points(p, x0, y0),
        "mounting_holes": {"diameter": p["pcb_hole_d"], "centres": [bc(h) for h in p["pcb_holes"]]},
        "battery_notch": {"centre_x": round(p["battery_notch"][0] - x0, 2), "width": p["battery_notch"][1], "depth": p["battery_notch"][2]},
        "antenna_notch": {"centre_x": round(p["antenna_notch"][0] - x0, 2), "width": p["antenna_notch"][1], "depth": p["antenna_notch"][2], "edge": "bottom"},
        "stick_centre": bc(p["stick_xy"]),
        "stick_holes": stick_holes(p, x0, y0),
        "face_buttons": faces,
        "face_contact_diameter": p["face_contact_d"],
        "select": bc(p["select_xy"]), "start": bc(p["start_xy"]), "home": bc(p["home_xy"]),
        "status_led": bc(p["led_xy"]), "boot_switch": bc(p["boot_xy"]),
        "radio_module": {"left": round(mx - x0, 2), "bottom": round(my - y0, 2), "width": mw, "height": mh, "antenna": "bottom edge"},
        "usb_c_centre_x": round(p["usb_x"] - x0, 2),
        "charge_leds_x": round(p["charge_led_x"] - x0, 2),
        "slide_switch_centre_x": round(p["switch_x"] - x0, 2),
        "battery_socket": bc(p["jst_xy"]),
        "battery_socket_note": "side entry, mouth facing left; the plug lies along the bottom edge and the lead drops through the notch",
        "shoulder_switches_x": {name: round(x - x0, 2) for name, x, _ in shoulders(p)},
        "back_supports": [bc(c) for c in p["back_supports"]],
        "note": "USB-C, the slide switch and the four shoulder switches sit on the top edge, facing off the board.",
    }


def outline_path(p, ox, oy):
    """The outline as an SVG path, in millimetres, with the top-left of the drawing at (ox, oy)."""
    corners = outline_corners(p)
    n = len(corners)
    xs = [c[0] for c in corners]
    top = max(c[1] for c in corners)
    left = min(xs)
    cuts = []
    for i, (x, y, r) in enumerate(corners):
        px, py, _ = corners[i - 1]
        nx, ny, _ = corners[(i + 1) % n]
        ux, uy, vx, vy = px - x, py - y, nx - x, ny - y
        lu, lv = math.hypot(ux, uy), math.hypot(vx, vy)
        ux, uy, vx, vy = ux / lu, uy / lu, vx / lv, vy / lv
        t = r / math.tan(math.acos(max(-1.0, min(1.0, ux * vx + uy * vy))) / 2)
        cuts.append(((x + ux * t, y + uy * t), (x + vx * t, y + vy * t), r, ux * vy - uy * vx))

    def pt(q):
        return "%.2f,%.2f" % (ox + q[0] - left, oy + top - q[1])

    d = "M" + pt(cuts[0][1])
    for i in range(1, n + 1):
        a, b, r, cross = cuts[i % n]
        d += " L%s A%.2f,%.2f 0 0 %d %s" % (pt(a), r, r, 1 if cross > 0 else 0, pt(b))
    return d + " Z", left, top


def template_svg(p):
    """A full-size drawing of the front: print it at 100 % (check the 50 mm bar with a ruler), cut it out
    and hold it, to judge the size and the reach to each button before printing anything in plastic."""
    w, h = outline_size(p)
    m = 12.0
    d, left, top = outline_path(p, m, m)

    def X(x):
        return m + x - left

    def Y(y):
        return m + top - y

    g = p["plunger_gap"]
    out = ['<svg xmlns="http://www.w3.org/2000/svg" width="%.1fmm" height="%.1fmm" viewBox="0 0 %.1f %.1f">' % (w + 2 * m, h + 2 * m + 20, w + 2 * m, h + 2 * m + 20),
           '<g fill="none" stroke="#000" stroke-width="0.3">', '<path d="%s"/>' % d]
    sx, sy = p["stick_xy"]
    out.append('<circle cx="%.2f" cy="%.2f" r="%.2f"/>' % (X(sx), Y(sy), p["stick_open_d"] / 2))
    out.append('<circle cx="%.2f" cy="%.2f" r="9.5" stroke-dasharray="1 1"/>' % (X(sx), Y(sy)))
    for (x, y) in face_centres(p).values():
        out.append('<circle cx="%.2f" cy="%.2f" r="%.2f"/>' % (X(x), Y(y), p["face_cap_d"] / 2 + g))
    for key in ("select_xy", "start_xy"):
        x, y = p[key]
        out.append('<circle cx="%.2f" cy="%.2f" r="%.2f"/>' % (X(x), Y(y), p["select_cap_d"] / 2 + g))
    hx, hy = p["home_xy"]
    out.append('<circle cx="%.2f" cy="%.2f" r="%.2f"/>' % (X(hx), Y(hy), p["home_cap_d"] / 2 + g))
    lx, ly = p["led_xy"]
    out.append('<circle cx="%.2f" cy="%.2f" r="1"/>' % (X(lx), Y(ly)))
    for _, x, wd in shoulders(p):
        out.append('<path d="M%.2f,%.2f v-3 M%.2f,%.2f v-3"/>' % (X(x - wd / 2), Y(p["bar_h"] / 2 - 2), X(x + wd / 2), Y(p["bar_h"] / 2 - 2)))
    by = h + 2 * m + 4
    out.append('<path d="M%.2f,%.2f h50 M%.2f,%.2f v4 M%.2f,%.2f v4"/>' % (m, by, m, by - 2, m + 50, by - 2))
    out.append('</g>')
    out.append('<text x="%.2f" y="%.2f" font-family="sans-serif" font-size="3">This bar is 50 mm. If it measures anything else, print again at 100 %%.</text>' % (m + 53, by + 1))
    out.append('<text x="%.2f" y="%.2f" font-family="sans-serif" font-size="3">Project Daedalus, front, full size (%.0f x %.0f mm). Dashed circle: thumb cap. Ticks at the top: shoulder buttons.</text>' % (m, by + 8, w, h))
    out.append('</svg>')
    return "\n".join(out) + "\n"


# ------------------------------------------------------------------------------------------------ output
def export(shape, name, tolerance=0.03):
    cq.exporters.export(shape, os.path.join(HERE, name), tolerance=tolerance, angularTolerance=0.15)


def main():
    p = P
    parts = {
        "front_shell": front_shell(p),
        "back_shell": back_shell(p),
        "face_button": face_cap(p),
        "select_start_button": small_cap(p, p["select_cap_d"]),
        "home_button": small_cap(p, p["home_cap_d"]),
        "shoulder_l1": plunger(p, p["l1_x"], p["shoulder_w1"]),      # L1 and R1 are mirror images: their ends
        "shoulder_r1": plunger(p, p["r1_x"], p["shoulder_w1"]),      #   follow the curve of the shoulder
        "shoulder_l2_r2": plunger(p, p["l2_x"], p["shoulder_w2"]),
        "coupon": coupon(p),
    }
    for name, shape in parts.items():
        export(shape, name + ".stl")
        vol = shape.val().Volume() / 1000.0
        bb = shape.val().BoundingBox()
        print("%-22s %6.1f cm3   %6.1f x %5.1f x %5.1f mm" % (name, vol, bb.xlen, bb.ylen, bb.zlen))

    assembly = (cq.Assembly()
                .add(parts["front_shell"], name="front_shell", color=cq.Color(0.85, 0.85, 0.88))
                .add(parts["back_shell"], name="back_shell", color=cq.Color(0.25, 0.27, 0.3))
                .add(board(p), name="board", color=cq.Color(0.1, 0.45, 0.25)))
    assembly.save(os.path.join(HERE, "daedalus_case.step"))

    outline = cq.Workplane("XY").add(board(p)).section()
    cq.exporters.export(outline, os.path.join(HERE, "board.dxf"))
    with open(os.path.join(HERE, "template.svg"), "w") as f:
        f.write(template_svg(p))
    with open(os.path.join(HERE, "layout.json"), "w") as f:
        json.dump(layout(p), f, indent=2)
        f.write("\n")
    z = z_levels(p)
    w, h = outline_size(p)
    print("thickness %.1f mm, overall %.0f x %.0f mm" % (z["front_out"] - z["back_out"], w, h))


if __name__ == "__main__":
    main()
