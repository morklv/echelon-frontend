const API_URL = "https://echelon-c6sf.onrender.com";
let token = "";
let currentUserRole = null;
const isAdmin = () => currentUserRole === "admin";
const isOperator = () => currentUserRole === "operator";
let map;
let markersLayer;
let infrastructureLayer;
let riskOverlayLayer;
let dependencyLayer;
let socket;
let incidentMarkers = {};
let refreshTimer = null;

function scheduleRefresh() {
    if (refreshTimer) {
        clearTimeout(refreshTimer);
    }

    refreshTimer = setTimeout(() => {
        loadIncidents();
        loadInfrastructureAssets();
        loadInfrastructureDependencies();
        refreshTimer = null;
    }, 500);
}


function initializeMap() {
    // creates Leaflet tactical map

    if (map) {
        return;
    }

    map = L.map("map", {
        zoomControl: false
    }).setView([37.7749, -122.4149], 12);

    L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        {
            subdomains: "abcd",
            maxZoom: 20,
            attribution: ""
        }
    ).addTo(map);

    riskOverlayLayer = L.layerGroup().addTo(map);
    dependencyLayer = L.layerGroup().addTo(map);
    infrastructureLayer = L.layerGroup().addTo(map);
    markersLayer = L.layerGroup().addTo(map);
}


async function registerUser() {
    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;
    const response = await fetch(`${API_URL}/auth/register`, {
        method: "POST",

        headers: {
            "Content-Type": "application/json"
        },

        body: JSON.stringify({
            username: username,
            // email: email,
            password: password,
            role: "operator"
        })
    });
    const data = await response.json();
    document.getElementById("auth-status").innerText =
        response.ok
            ? `Registered: ${data.username}`
            : `Register failed: ${JSON.stringify(data.detail)}`;
}


async function loginUser() {

    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;
    const formData = new URLSearchParams();
    formData.append("username", username);
    formData.append("password", password);

    const response = await fetch(`${API_URL}/auth/login`, {
        method: "POST",

        headers: {
            "Content-Type": "application/x-www-form-urlencoded"
        },

        body: formData.toString()
    });

    const data = await response.json();

    if (!response.ok) {
        document.getElementById("auth-status").innerText =
            `Login failed: ${JSON.stringify(data.detail)}`;
        return;
    }

    token = data.access_token;

    currentUserRole = data.role;
 
    updateRoleIndicator();
    applyRolePermissions();

    document.getElementById("auth-status").innerText =
        "Logged in successfully";

    document.getElementById("auth-panel").style.display = "none";
    document.body.classList.add("authenticated");

    const dashboard = document.getElementById("main-dashboard");
    dashboard.classList.remove("hidden-dashboard");
    dashboard.classList.add("visible-dashboard");

    initializeMap();
    connectWebSocket();

    loadInfrastructureAssets();
    loadInfrastructureDependencies();
    loadIncidents();

    console.log("Logged in role:", currentUserRole);
    
}
function setButtonLoading(button, isLoading, loadingText, normalText) {
    if (!button) return;

    button.disabled = isLoading;
    button.innerHTML = isLoading
        ? `<span class="mini-spinner"></span> ${loadingText}`
        : normalText;
}

function updateRoleIndicator() {

    const roleIndicator = document.getElementById("role-indicator");

    if (!roleIndicator) {
        return;
    }

    roleIndicator.innerText = `ROLE: ${currentUserRole.toUpperCase()}`;

    if (isAdmin()) {
        roleIndicator.style.color = "#ef4444";
    }

    else if (isOperator()) {
        roleIndicator.style.color = "#00e5ff";
    }
}


function applyRolePermissions() {
    const createIncidentButton = document.querySelector(".drawer-toggle");
    if (!createIncidentButton) {
        return;
    }
    createIncidentButton.style.display = "block";
}


async function createIncident() {

    const title = document.getElementById("incident-title").value;

    const category = document.getElementById("incident-category").value;

    const severity = Number(document.getElementById("incident-severity").value);

    const description = document.getElementById("incident-description").value;

    const latitude = Number(document.getElementById("latitude").value);
    const longitude = Number(document.getElementById("longitude").value);

    const response = await fetch(`${API_URL}/incidents/`, {
        method: "POST",

        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
        },

        body: JSON.stringify({
            title: title,
            category: category,
            severity: severity,
            description: description,
            latitude: latitude,
            longitude: longitude
        })
    });

    const data = await response.json();

    if (response.ok) {


        scheduleRefresh();

        addIntelligenceFeedItem(
            "info",
            `Incident created: ${title}`
        );
    }

    else {
        alert(`Failed to create incident: ${JSON.stringify(data.detail)}`);
    }
}


function getSeverityColor(severity) {

    if (severity >= 5) {
        return "#ff3b30";
    }

    if (severity >= 4) {
        return "#ff9500";
    }

    if (severity >= 3) {
        return "#ffd60a";
    }

    return "#00e5ff";

}


async function getNearbyInfrastructureHtml(incidentId) {

    const response = await fetch(
        `${API_URL}/incidents/${incidentId}/nearby-infrastructure`,
        {
            headers: {
                "Authorization": `Bearer ${token}`
            }
        }
    );

    if (!response.ok) {
        return `
            <div class="infrastructure-risk-block">
                <h4>Affected Infrastructure</h4>
                <p>Infrastructure risk unavailable</p>
            </div>
        `;
    }

    const data = await response.json();

    const assets = data.nearby_assets || [];

    const recommendation =
        data.infrastructure_recommendation || "No recommendation available.";

    const operationalRiskScore = data.operational_risk_score ?? "N/A";

    const criticalAssetCount = data.critical_asset_count ?? 0;

    const cascadeAssetCount = data.cascade_asset_count ?? 0;


    if (assets.length === 0) {
        return `
            <div class="infrastructure-risk-block">
                <h4>Affected Infrastructure</h4>
                <p>No nearby critical assets detected</p>

                <div class="infrastructure-recommendation">
                    <h4>Infrastructure Recommendation</h4>
                    <pre>${recommendation}</pre>
                </div>
            </div>
        `;
    }

    const assetRows = assets.map(asset => `
        <div class="asset-risk-row">
            <strong>${asset.name}</strong>

            <p>Type: ${asset.asset_type}</p>
            <p>Criticality: ${asset.criticality}</p>
            <p>Operational Status: ${asset.operational_status}</p>
            <p>Risk Status: ${asset.risk_status || "UNKNOWN"}</p>

            ${
                asset.risk_status === "CASCADE_RISK"
                    ? `
                        <p>Impact Type: Cascade dependency</p>
                        <p>Cascade Source: ${asset.source_asset_name || "Unknown source"}</p>
                        <p>Dependency Type: ${asset.dependency_type || "dependency"}</p>
                    `
                    : `
                        <p>Distance: ${asset.distance_km} km</p>
                    `
            }

            ${
                asset.cascade_reason
                    ? `<p>Cascade Reason: ${asset.cascade_reason}</p>`
                    : ""
            }
        </div>
    `).join("");

    return `
        <div class="infrastructure-risk-block">
            <h4>Affected Infrastructure</h4>

            <div class="infrastructure-summary">
                <p><strong>Infrastructure Risk Score:</strong> ${operationalRiskScore}</p>
                <p><strong>Critical Assets:</strong> ${criticalAssetCount}</p>
                <p><strong>Cascade Impacts:</strong> ${cascadeAssetCount}</p>
            </div>

            ${assetRows}

            <div class="infrastructure-recommendation">
                <h4>Infrastructure Recommendation</h4>
                <pre>${recommendation}</pre>
            </div>
        </div>
    `;

}
async function showIncidentInfrastructure(incidentId) {
    const block = document.getElementById(`infra-block-${incidentId}`);

    if (!block) {
        return;
    }

    block.innerHTML = `
        <div class="loading-state">
            <span class="mini-spinner"></span>
            Loading affected infrastructure...
        </div>
    `;

    const html = await getNearbyInfrastructureHtml(incidentId);

    block.innerHTML = html;

    loadInfrastructureAssets();
    loadInfrastructureDependencies();
}


function drawInfrastructureRiskZone(incident, nearbyAssets) {

    riskOverlayLayer.clearLayers();

    const riskCircle = L.circle(
        [incident.latitude, incident.longitude],
        {
            radius: 1000,

            color: "rgba(220, 220, 220, 0.85)",

            fillColor: "rgba(120, 120, 120, 0.35)",

            fillOpacity: 0.12,

            opacity: 0.95,

            weight: 2,

            dashArray: "8 8"
        }
    );

    riskCircle.addTo(riskOverlayLayer);

    riskCircle.bringToFront();

    nearbyAssets.forEach(asset => {

        if (!asset.latitude || !asset.longitude) {
            return;
        }

        const line = L.polyline(
            [
                [incident.latitude, incident.longitude],
                [asset.latitude, asset.longitude]
            ],
            {
                color: "rgba(220,220,220,0.45)",

                weight: 1.2,

                opacity: 0.7,

                dashArray: "4 8"
            }
        );

        line.addTo(riskOverlayLayer);
    });
}


async function loadIncidents() {

    const response = await fetch(`${API_URL}/incidents/`, {
        method: "GET",

        headers: {
            "Authorization": `Bearer ${token}`
        }
    });

    const data = await response.json();

    if (!response.ok) {
        console.log("Failed to load incidents:", data);

        document.getElementById("incident-list").innerHTML =
            `<p>Failed to load incidents. Please log in first.</p>`;

        return;
    }

    const incidents = Array.isArray(data) ? data : [];

    document.getElementById("total-incidents").innerText =
        incidents.length;

    document.getElementById("high-severity-count").innerText =
        incidents.filter(incident => incident.severity >= 4).length;

    document.getElementById("open-incidents-count").innerText =
        incidents.filter(incident => incident.status === "open").length;

    document.getElementById("closed-incidents-count").innerText =
        incidents.filter(
            incident =>
                incident.status === "closed" ||
                incident.status === "resolved"
        ).length;

    const severityFilter = document.getElementById("severity-filter").value;

    const statusFilter = document.getElementById("status-filter").value;

    const categoryFilter =
        document.getElementById("category-filter").value.toLowerCase();

    const incidentList = document.getElementById("incident-list");
    incidentList.innerHTML = `
        <div class="loading-state">
            <span class="mini-spinner"></span>
            Loading incidents...
        </div>
    `;


    incidentList.innerHTML = "";
    markersLayer.clearLayers();
    incidentMarkers = {};

    for (const [index, incident] of incidents.entries()) {

        if (severityFilter && incident.severity != severityFilter) {
            continue;
        }

        if (statusFilter && incident.status !== statusFilter) {
            continue;
        }

        if (
            categoryFilter &&
            !incident.category.toLowerCase().includes(categoryFilter)
        ) {
            continue;
        }

        const canEditIncidents = true;
        const canDeleteIncidents = isAdmin();
        const card = document.createElement("div");

        card.className = "incident-card";

        card.id = `incident-card-${incident.id}`;

        card.innerHTML = `
            <h3>${incident.title}</h3>

            <p><strong>ID:</strong> ${index + 1}</p>
            <p><strong>Database ID:</strong> ${incident.id}</p>
            <p><strong>Category:</strong> ${incident.category}</p>

            <p>
                <span class="badge" style="background-color: ${getSeverityColor(incident.severity)};">
                    SEVERITY ${incident.severity}
                </span>

                <span class="badge status-badge">
                    ${incident.status.toUpperCase()}
                </span>
            </p>

            <p><strong>Description:</strong> ${incident.description || "No description"}</p>

            <p><strong>Location:</strong> ${incident.latitude}, ${incident.longitude}</p>
            ${
                incident.image_path
                    ? `
                        <div class="incident-image-preview">
                            <img
                                src="${API_URL}${incident.image_path}"
                                alt="Incident evidence image"
                            />
                        </div>
                    `
                    : `
                        <div class="incident-image-placeholder">
                            No evidence image uploaded
                        </div>
                    `
            }
            <p><strong>Image Analysis:</strong> ${formatImageAnalysis(incident.image_analysis)}</p>

            <div class="llm-brief">
                <h4>Operator Brief</h4>
                <pre>${incident.llm_summary || "No summary yet"}</pre>
            </div>

           <div
                id="infra-block-${incident.id}"
                class="infrastructure-risk-block"
            >
                <h4>Affected Infrastructure</h4>
                <p>Click below to load direct and cascaded asset impact.</p>
            </div>

            <button onclick="showIncidentInfrastructure(${incident.id})">
                Show affected infrastructure
            </button>

            <div class="evidence-upload">
                <label
                    class="evidence-upload-label"
                    for="image-input-${incident.id}"
                >
                    <span class="upload-title">
                        Upload Evidence Image
                    </span>

                    <span class="upload-subtitle">
                        JPG / PNG / WEBP · Max 5MB
                    </span>
                </label>

                <input
                    id="image-input-${incident.id}"
                    class="hidden-file-input"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                />
            </div>

            <button
                id="upload-btn-${incident.id}"
                onclick="uploadImageForIncident(${incident.id})">
                Upload image for this incident
            </button>

            ${canEditIncidents ? `
                <button onclick='openIncidentEditDrawer(${JSON.stringify(incident)})'>
                    Update Incident
                </button>
            ` : ""}

            ${canDeleteIncidents ? `
                <button onclick="deleteIncident(${incident.id})">
                    Delete Incident
                </button>
            ` : ""}

            <button onclick="focusIncidentOnMap(${incident.id})">
                Focus on Map
            </button>
        `;

        incidentList.appendChild(card);

        const incidentColor =
            incident.status === "resolved"
                ? "#64748b"
                : getSeverityColor(incident.severity);

        const incidentIcon = L.divIcon({
            className: "incident-pulse-icon",

            html: `
                <div
                    class="
                        incident-pulse
                        ${incident.severity >= 5 ? "incident-critical" : ""}
                        ${incident.status === "resolved" ? "incident-resolved" : ""}
                    "
                    style="--incident-color:${incidentColor};"
                >
                    <div class="incident-pulse-ring"></div>
                    <div class="incident-pulse-ring second"></div>
                    <div class="incident-pulse-core"></div>
                </div>
            `,

            iconSize: [34, 34],
            iconAnchor: [17, 17]
        });

        const marker = L.marker(
            [incident.latitude, incident.longitude],
            {
                icon: incidentIcon
            }
        ).addTo(markersLayer);

        incidentMarkers[incident.id] = marker;

        marker.bindPopup(
            `
                <strong>${incident.title}</strong><br>
                Category: ${incident.category}<br>
                Severity: ${incident.severity}<br>
                Status: ${incident.status}
            `,
            {
                autoPan: false
            }
        );


        marker.on("click", () => {
            highlightIncidentCard(incident.id);
        });

    }
}


async function uploadImageForIncident(incidentId) {

    const uploadButton = document.getElementById(`upload-btn-${incidentId}`);

    setButtonLoading(
        uploadButton,
        true,
        "Analyzing image...",
        "Upload image for this incident"
    );

    try {
        const fileInput = document.getElementById(`image-input-${incidentId}`);
        const file = fileInput.files[0];
        if (!file) {
            alert("Please choose an image first.");
            return;
        }

        const formData = new FormData();
        formData.append("file", file);
        const response = await fetch(
            `${API_URL}/incidents/${incidentId}/upload-image`,
            {
                method: "POST",

                headers: {
                    "Authorization": `Bearer ${token}`
                },

                body: formData
            }
        );

        const data = await response.json();

        if (response.ok) {
            addIntelligenceFeedItem(
                "info",
                `Analyzing image for incident ${incidentId}`
            );

            scheduleRefresh();
        }

        else {
            alert(`Image upload failed: ${JSON.stringify(data.detail)}`);
        }
    }

    finally {
        setButtonLoading(
            uploadButton,
            false,
            "Analyzing image...",
            "Upload image for this incident"
        );
    }
}


function openIncidentEditDrawer(incident) {
    document.getElementById("edit-incident-id").value = incident.id;

    document.getElementById("edit-incident-title").value =
        incident.title;

    document.getElementById("edit-incident-description").value =
        incident.description || "";

    document.getElementById("edit-incident-category").value =
        incident.category;

    document.getElementById("edit-incident-status").value =
        incident.status;

    document.getElementById("edit-incident-severity").value =
        incident.severity;

    document.getElementById("edit-incident-latitude").value =
        incident.latitude;

    document.getElementById("edit-incident-longitude").value =
        incident.longitude;

    document
        .getElementById("incident-edit-drawer")
        .classList.add("incident-edit-drawer-open");

    const feedPanel = document.getElementById(
        "intelligence-feed-panel"
    );

    feedPanel.classList.remove("feed-shift-create");
    feedPanel.classList.add("feed-shift-edit");
}


function closeIncidentEditDrawer() {
    document
        .getElementById("incident-edit-drawer")
        .classList.remove("incident-edit-drawer-open");

    const feedPanel = document.getElementById(
        "intelligence-feed-panel"
    );

    feedPanel.classList.remove("feed-shift-edit");
}


async function submitIncidentUpdate() {
    const incidentId = document.getElementById("edit-incident-id").value;

    const title =
        document.getElementById("edit-incident-title").value;

    const description =
        document.getElementById("edit-incident-description").value;

    const category =
        document.getElementById("edit-incident-category").value;

    const status =
        document.getElementById("edit-incident-status").value;

    const severity = Number(
        document.getElementById("edit-incident-severity").value
    );

    const latitude = Number(
        document.getElementById("edit-incident-latitude").value
    );

    const longitude = Number(
        document.getElementById("edit-incident-longitude").value
    );

    const response = await fetch(
        `${API_URL}/incidents/${incidentId}`,
        {
            method: "PATCH",

            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },

            body: JSON.stringify({
                title: title,
                description: description.trim() === "" ? null : description,
                category: category,
                status: status,
                severity: severity,
                latitude: latitude,
                longitude: longitude
            })
        }
    );

    const data = await response.json();

    if (response.ok) {
        addIntelligenceFeedItem(
            "info",
            "Incident updated successfully");

        closeIncidentEditDrawer();

        scheduleRefresh();
    }

    else {
        alert(`Update failed: ${JSON.stringify(data.detail)}`);
    }
}


async function updateInfrastructureAsset(asset) {

    if (!isAdmin()) {
        addIntelligenceFeedItem(
            "warning",
            "Only admins can edit infrastructure assets"
        );
        return;
    }

    const name = prompt("New asset name:", asset.name) || asset.name;

    const assetType =
        prompt("New asset type:", asset.asset_type) || asset.asset_type;

    const latitude =
        prompt("New latitude:", asset.latitude) || asset.latitude;

    const longitude =
        prompt("New longitude:", asset.longitude) || asset.longitude;

    const criticality =
        prompt("New criticality:", asset.criticality) || asset.criticality;

    const description =
        prompt("New description:", asset.description) || asset.description;

    const operationalStatus =
        prompt("Operational status:", asset.operational_status) ||
        asset.operational_status;

    const response = await fetch(
        `${API_URL}/infrastructure/${asset.id}`,
        {
            method: "PATCH",

            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },

            body: JSON.stringify({
                name: name,
                asset_type: assetType,
                latitude: Number(latitude),
                longitude: Number(longitude),
                criticality: criticality,
                description: description,
                operational_status: operationalStatus,
                geometry_type: asset.geometry_type,
                geometry_coordinates: asset.geometry_coordinates
            })
        }
    );

    const data = await response.json();

    if (response.ok) {
        addIntelligenceFeedItem(
            "info",
            "Infrastructure asset updated successfully");
        loadInfrastructureAssets();
        loadInfrastructureDependencies();
    }

    else {
        alert(`Infrastructure update failed: ${JSON.stringify(data.detail)}`);
    }
}


function formatImageAnalysis(imageAnalysis) {

    if (!imageAnalysis) {
        return `<p><strong>Image Analysis:</strong> No analysis yet</p>`;
    }

    let analysis;

    try {
        analysis = JSON.parse(imageAnalysis);
    }

    catch {
        return `<p><strong>Image Analysis:</strong> Invalid analysis data</p>`;
    }

    const blurryText = analysis.is_blurry ? "Yes" : "No";
    const detectedObjects = analysis.detected_objects || [];
    const objectsText = detectedObjects.length > 0
        ? detectedObjects
            .map(obj => `${obj.label} (${Math.round(obj.confidence * 100)}%)`)
            .join(", ")
        : "No known objects detected";
        
    const hazard = analysis.hazard_analysis || {};
    const fireSmoke = analysis.fire_smoke_analysis || {};
    const structural = analysis.structural_analysis || {};
    const fusion = analysis.intelligence_fusion || {};
    const scene = analysis.scene_analysis || {};
    const traffic = analysis.traffic_activity || {};


    return `
        <div class="analysis-block">
            <h4>Image Quality</h4>
            <p><strong>Blur Score:</strong> ${analysis.blur_score ?? "N/A"}</p>
            <p><strong>Blurry:</strong> ${blurryText}</p>

            <hr>

            <h4>Detected Objects</h4>
            <p>${objectsText}</p>

            <hr>

            <h4>Structural Analysis</h4>
            <p><strong>Damage Tier:</strong> ${structural.damage_tier || "UNKNOWN"}</p>
            <p><strong>Damage Score:</strong> ${structural.damage_score ?? "N/A"}</p>
            <p><strong>Edge Density:</strong> ${structural.edge_density ?? "N/A"}</p>
            <p><strong>Line Count:</strong> ${structural.line_count ?? "N/A"}</p>
            <p><strong>Line Angle Variance:</strong> ${structural.line_angle_variance ?? "N/A"}</p>

            <hr>

            <h4>Scene Analysis</h4>
            <p><strong>Person Count:</strong> ${scene.person_count ?? "N/A"}</p>
            <p><strong>Vehicle Count:</strong> ${scene.vehicle_count ?? "N/A"}</p>
            <p><strong>Total Entities:</strong> ${scene.total_entities ?? "N/A"}</p>
            <p><strong>Density Tier:</strong> ${scene.density_tier || "UNKNOWN"}</p>
            <p><strong>Abnormal Cluster:</strong> ${scene.abnormal_cluster_detected ? "Yes" : "No"}</p>

            <hr>

            <h4>Hazard Analysis</h4>
            <p><strong>Hazard Tier:</strong> ${hazard.hazard_tier || "UNKNOWN"}</p>
            <p><strong>Hazard Confidence:</strong> ${hazard.hazard_confidence ?? "N/A"}</p>
            <p><strong>Fire Pixel Ratio:</strong> ${hazard.fire_pixel_ratio ?? "N/A"}</p>
            <p><strong>Smoke Pixel Ratio:</strong> ${hazard.smoke_pixel_ratio ?? "N/A"}</p>
            <p><strong>Texture Variance:</strong> ${hazard.texture_variance ?? "N/A"}</p>

            <hr>

            <h4>Fire / Smoke Analysis</h4>
            <p><strong>Hazard Tier:</strong> ${fireSmoke.hazard_tier || "UNKNOWN"}</p>
            <p><strong>Fire Score:</strong> ${fireSmoke.fire_score ?? "N/A"}</p>
            <p><strong>Smoke Score:</strong> ${fireSmoke.smoke_score ?? "N/A"}</p>
            <p><strong>Fire Pixel Ratio:</strong> ${fireSmoke.fire_pixel_ratio ?? "N/A"}</p>
            <p><strong>Smoke Pixel Ratio:</strong> ${fireSmoke.smoke_pixel_ratio ?? "N/A"}</p>
            <p><strong>Texture Variance:</strong> ${fireSmoke.texture_variance ?? "N/A"}</p>

            <hr>

            <h4>Traffic Activity</h4>
            <p><strong>Vehicle Count:</strong> ${traffic.vehicle_count ?? "N/A"}</p>
            <p><strong>Person Count:</strong> ${traffic.person_count ?? "N/A"}</p>
            <p><strong>Total Road Entities:</strong> ${traffic.total_road_entities ?? "N/A"}</p>
            <p><strong>Traffic Density:</strong> ${traffic.traffic_density || "UNKNOWN"}</p>
            <p><strong>Road Activity:</strong> ${traffic.road_activity_detected ? "Yes" : "No"}</p>

            <hr>

            <h4>Composite Intelligence</h4>
            <p><strong>Overall Risk Score:</strong> ${fusion.overall_risk_score ?? "N/A"}</p>
            <p><strong>Risk Tier:</strong> ${fusion.risk_tier || "UNKNOWN"}</p>
            <p><strong>Primary Hazard:</strong> ${fusion.primary_hazard || "UNKNOWN"}</p>
            <p><strong>Structural Damage:</strong> ${fusion.structural_damage || "UNKNOWN"}</p>
            <p><strong>Recommended Action:</strong> ${fusion.recommended_action || "N/A"}</p>
        </div>
    `;

}


function connectWebSocket() {

    socket = new WebSocket("wss://echelon-c6sf.onrender.com/ws");

    socket.onopen = () => {
        console.log("WebSocket connected");
    };

    socket.onmessage = (event) => {

        const data = JSON.parse(event.data);
        const eventType = data.event || data.event_type;
        console.log("WebSocket event received:", data);

        if (eventType === "incident_created") {
            addIntelligenceFeedItem(
                "info",
                `New incident created: ID ${data.incident_id}`
            );

            scheduleRefresh();
        }

        if (eventType === "incident_updated") {
            addIntelligenceFeedItem(
                "info",
                `Incident updated: ID ${data.incident_id}`
            );

            scheduleRefresh();
        }

        if (eventType === "incident_deleted") {
            addIntelligenceFeedItem(
                "warning",
                `Incident deleted: ID ${data.incident_id}`
            );

            scheduleRefresh();
        }

        if (eventType === "analysis_completed") {
            addIntelligenceFeedItem(
                "critical",
                `Image intelligence analysis completed for incident ${data.incident_id}`
            );

            scheduleRefresh();
        }

        if (eventType === "infrastructure_updated") {
            addIntelligenceFeedItem(
                "warning",
                "Infrastructure dependency state updated"
            );

            scheduleRefresh();
        }
    };

    socket.onclose = () => {
        console.log("WebSocket disconnected. Reconnecting in 3 seconds...");

        setTimeout(() => {
            connectWebSocket();
        }, 3000);
    };

}


async function deleteIncident(incidentId) {

    if (!isAdmin()) {
        addIntelligenceFeedItem(
            "warning",
            "Only admins can delete incidents"
        );

        return;
    }

    const confirmed = confirm(`Delete incident ${incidentId}?`);

    if (!confirmed) {
        return;
    }

    const response = await fetch(`${API_URL}/incidents/${incidentId}`, {
        method: "DELETE",

        headers: {
            "Authorization": `Bearer ${token}`
        }
    });

    const data = await response.json();

    if (response.ok) {
        addIntelligenceFeedItem(
            "warning",
            "Incident deleted successfully");
        scheduleRefresh();;
    }

    else {
        alert(`Delete failed: ${JSON.stringify(data.detail)}`);
    }
}


function clearFilters() {

    document.getElementById("severity-filter").value = "";
    document.getElementById("status-filter").value = "";
    document.getElementById("category-filter").value = "";
    loadIncidents();
}


async function focusIncidentOnMap(incidentId) {
    const marker = incidentMarkers[incidentId];

    if (!marker) {
        alert("No marker found for this incident.");
        return;
    }

    const markerPosition = marker.getLatLng();
    map.setView(markerPosition, 15);
    marker.openPopup();
    const response = await fetch(
        `${API_URL}/incidents/${incidentId}/nearby-infrastructure`,
        {
            headers: {
                "Authorization": `Bearer ${token}`
            }
        }
    );

    const data = await response.json();
    const nearbyAssets = data.nearby_assets || [];

    drawInfrastructureRiskZone(
        {
            latitude: markerPosition.lat,
            longitude: markerPosition.lng
        },
        nearbyAssets
    );

    loadInfrastructureAssets();
    loadInfrastructureDependencies();

}


function highlightIncidentCard(incidentId) {
    const drawer = document.getElementById("incidents-drawer");

    const card = document.getElementById(
        `incident-card-${incidentId}`
    );

    if (!drawer || !card) {
        return;
    }

    if (!drawer.classList.contains("incidents-drawer-open")) {
        drawer.classList.add("incidents-drawer-open");
    }

    card.scrollIntoView({
        behavior: "smooth",
        block: "start"
    });

    card.classList.add("highlighted-card");

    setTimeout(() => {
        card.classList.remove("highlighted-card");
    }, 2000);
}

function toggleIncidentDrawer() {
    if (!currentUserRole) {
        addIntelligenceFeedItem(
            "warning",
            "Authentication required"
        );
        return;
    }

    const drawer = document.getElementById("incident-drawer");

    const createButton =
        document.querySelector(".drawer-toggle:not(.incidents-toggle)");

    const incidentsButton =
        document.querySelector(".incidents-toggle");

    const feedPanel =
        document.getElementById("intelligence-feed-panel");

    const isOpen = drawer.classList.contains("drawer-open");

    if (!isOpen) {
        createButton.classList.add("hide-drawer-button");
        incidentsButton.classList.add("hide-drawer-button");

        feedPanel.classList.add("feed-shift-create");
        feedPanel.classList.remove("feed-shift-edit");

        drawer.classList.add("drawer-open");
    }

    else {
        drawer.classList.remove("drawer-open");

        feedPanel.classList.remove("feed-shift-create");

        setTimeout(() => {
            createButton.classList.remove("hide-drawer-button");
            incidentsButton.classList.remove("hide-drawer-button");
        }, 350);
    }
}


function toggleIncidentsDrawer() {

    const drawer = document.getElementById("incidents-drawer");
    const button = document.querySelector(".incidents-toggle");
    const isOpen = drawer.classList.contains("incidents-drawer-open");

    if (!isOpen) {
        button.classList.add("hide-drawer-button");

        setTimeout(() => {
            drawer.classList.add("incidents-drawer-open");
            loadIncidents();
        }, 300);
    }

    else {
        drawer.classList.remove("incidents-drawer-open");

        setTimeout(() => {
            button.classList.remove("hide-drawer-button");
        }, 400);

        riskOverlayLayer.clearLayers();
    }
}


function getAssetStatusClass(status) {

    if (status === "AT_RISK") {
        return "asset-at-risk";
    }

    if (status === "DEGRADED") {
        return "asset-degraded";
    }

    if (status === "OFFLINE") {
        return "asset-offline";
    }

    return "asset-normal";
}


async function loadInfrastructureAssets() {

    const response = await fetch(`${API_URL}/infrastructure/`);
    const assets = await response.json();

    infrastructureLayer.clearLayers();

    assets.forEach(asset => {
        const isCascadeRisk = asset.risk_status === "CASCADE_RISK";
        const assetOpacity = isAdmin() ? 1 : 0.72;
        const assetScale = isAdmin() ? 1.0 : 0.82;
        const assetIcon = L.divIcon({
            className: "infrastructure-icon",

            html: `
                <div
                    class="
                        asset-triangle
                        ${getAssetStatusClass(asset.operational_status)}
                        ${isCascadeRisk ? "cascade-risk" : ""}
                    "
                    style="
                        opacity: ${assetOpacity};
                        transform: scale(${assetScale});
                    "
                ></div>
            `,

            iconSize: [14, 14],
            iconAnchor: [7, 10]
        });

        const marker = L.marker(
            [asset.latitude, asset.longitude],
            {
                icon: assetIcon
            }
        ).addTo(infrastructureLayer);

        marker.bindPopup(
            `
                <strong>${asset.name}</strong><br>
                Type: ${asset.asset_type}<br><br>

                ${
                    isAdmin()
                        ? `
                            Criticality: ${asset.criticality}<br>
                            Status: ${asset.operational_status}<br>
                            Risk: ${asset.risk_status}<br>
                            ${asset.description || ""}<br><br>

                            <button onclick='updateInfrastructureAsset(${JSON.stringify(asset)})'>
                                Edit Asset
                            </button>
                        `
                        : `
                            Restricted infrastructure details
                        `
                }
            `,
            {
                autoPan: false
            }
        );
    });
}


async function loadInfrastructureDependencies() {

    const response = await fetch(`${API_URL}/infrastructure-dependencies/`);
    const data = await response.json();
    const dependencies = data.dependencies || [];

    dependencyLayer.clearLayers();

    dependencies.forEach(edge => {
        const source = edge.source;
        const dependent = edge.dependent;

        let lineColor = "#00e5ff";

        if (
            source.risk_status === "CASCADE_RISK" ||
            dependent.risk_status === "CASCADE_RISK"
        ) {
            lineColor = "#c084fc";
        }

        if (
            source.operational_status === "DEGRADED" ||
            dependent.operational_status === "DEGRADED"
        ) {
            lineColor = "#ff9500";
        }

        if (
            source.operational_status === "OFFLINE" ||
            dependent.operational_status === "OFFLINE"
        ) {
            lineColor = "#ff3b30";
        }

        const line = L.polyline(
            [
                [source.latitude, source.longitude],
                [dependent.latitude, dependent.longitude]
            ],
            {
                color: lineColor,
                weight: 1.4,
                opacity: 0.42,
                dashArray: "4 10",
                lineCap: "round",
                smoothFactor: 1.5,
                className: "dependency-flow-line"
            }
        );

        line.bindPopup(
            `
                <strong>Infrastructure Dependency</strong><br><br>

                <strong>Source:</strong> ${source.name}<br>
                ${source.asset_type}<br>
                Status: ${source.operational_status}<br><br>

                <strong>Dependent:</strong> ${dependent.name}<br>
                ${dependent.asset_type}<br>
                Status: ${dependent.operational_status}<br><br>

                <strong>Dependency:</strong> ${edge.dependency_type}<br>

                ${edge.description || ""}
            `,
            {
                autoPan: false
            }
        );

        line.addTo(dependencyLayer);
    });
}


function addIntelligenceFeedItem(level, message) {
    const feedList = document.getElementById("intelligence-feed-list");

    if (!feedList) {
        return;
    }
    if (!message) {
        return;
    }

    const now = new Date().toLocaleTimeString();
    const item = document.createElement("div");
    item.className = `intel-feed-item intel-${level}`;
    item.innerHTML = `
        <button
            class="intel-dismiss"
            onclick="dismissIntelFeedItem(this)"
        >
            ×
        </button>

        <span class="intel-time">${now}</span>

        <p>${message}</p>
    `;
    feedList.prepend(item);
}

function dismissIntelFeedItem(button) {

    const item = button.closest(".intel-feed-item");

    if (!item) {
        return;
    }

    item.classList.add("intel-feed-removing");
    setTimeout(() => {
        item.remove();
    }, 260);
}



