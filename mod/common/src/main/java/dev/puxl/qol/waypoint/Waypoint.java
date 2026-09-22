package dev.puxl.qol.waypoint;

/** A saved position in one dimension. */
public final class Waypoint implements Comparable<Waypoint> {
    public String name;
    public String dimension;
    public double x;
    public double y;
    public double z;
    public String color;
    public boolean temporary;
    public long createdAt;

    public Waypoint() {
    }

    public Waypoint(String name, String dimension, double x, double y, double z, String color, boolean temporary) {
        this.name = name;
        this.dimension = dimension;
        this.x = x;
        this.y = y;
        this.z = z;
        this.color = color;
        this.temporary = temporary;
        this.createdAt = System.currentTimeMillis();
    }

    public double distanceTo(double px, double py, double pz) {
        double dx = px - x;
        double dy = py - y;
        double dz = pz - z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    /** Horizontal distance, which is what players actually care about. */
    public double horizontalDistanceTo(double px, double pz) {
        double dx = px - x;
        double dz = pz - z;
        return Math.sqrt(dx * dx + dz * dz);
    }

    /** Bearing in degrees, 0 = south, matching Minecraft's yaw convention. */
    public double bearingFrom(double px, double pz) {
        double dx = x - px;
        double dz = z - pz;
        return Math.toDegrees(Math.atan2(-dx, dz));
    }

    @Override
    public int compareTo(Waypoint other) {
        return Long.compare(createdAt, other.createdAt);
    }
}
