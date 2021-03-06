/*
Script: visugps.js
        Display GPS track on Google Maps

License: GNU General Public License

This file is part of VisuGps

VisuGps is free software; you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation; either version 2 of the License, or
(at your option) any later version.

VisuGps is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with VisuGps; if not, write to the Free Software
Foundation, Inc., 51 Franklin St, Fifth Floor, Boston, MA  02110-1301  USA

Copyright (c) 2007-2010 Victor Berchet, <http://www.victorb.fr>

Credits:
    - Some code is inspired from by the Google Maps API tutorial of Mike Williams <http://www.econym.demon.co.uk/googlemaps/index.htm>
    - Some code is inspired from the XCPlanner of Tom Payne <https://github.com/twpayne/xcplanner>
*/

/*
Class: VisuGps
        Display a GPS track on top of Google Maps
*/
var VisuGps = new Class({
    Implements: Options,
    options: {
        mapDiv : 'map',
        chartDiv : 'vgps-chartcont',
        loadDiv : 'load',
        elevTileUrl : null,
        weatherTileUrl : null,
        measure : true,
        measureCfd : true,
        maxSpeed : 80,
        maxVario : 10,
        maxElev : 9999,
        showIgnMap : true
    },
    /*
    Property: initialize
            Class constructor.
            Initialize class members and create the map.

    Arguments:
            options - an object representing VisuGps options. See Options below.

    Options:
            mapDiv - the map container
            chartDiv - the chart container
            loadDiv - an overlay displayed masking the map during initialization
            elevTileURL - list of base URLs for elevation tiles (null = no elevation map)
            weatherTileURL - list of base URLs for weather tiles (null = no weather map)
            measure - true to allow distance measurment
            measureCfd - true to display CFD scoring in measurment mode
            maxSpeed - maximum value for the speed (min = 0)
            maxVario - maximum absolute value for the GR
            maxElev - maximum value for the elevation (min = 0)
            showIgnMap - wether or not to use IGN maps
    */
    initialize : function(options, route) {
        this.setOptions(options);
        this.map = {};
        this.track = {};
        this.points = [];
        this.charts = null;
        this.marker = {};
        this.marker3d = null;
        this.model3d = null;
        this.init3dMap = true;
        this.orientation = null;
        this.path = null;
        this.timer = null;
        this.infoCtrl = {};
        this.titleCtrl = {};
        this.nfo = null;
        this.animTimer = null;
        this.animPos = 0;
        this.animDelay = {'min':1, 'max':120, 'val': 60};
        this.mapTitle = 'VisuGps';
        this.ge = null;
        this.iFrameShim = false;
        this.route = null;

        this.mapSwitcher = null;
        this.ignMap = null;
        this.mapType = 'google';

        this.distPts = {};
        this.distState = 0;
        this.distLine = {};

        if (GBrowserIsCompatible()) {
            var map = $(this.options.mapDiv);
            if (!map) return;
            // Create the map, add standard controls and keyboard handler
            this.map = new google.maps.Map2(map, {mapTypes: [G_PHYSICAL_MAP,
                                                             G_HYBRID_MAP,
                                                             G_SATELLITE_MAP,
                                                             G_NORMAL_MAP,
                                                             G_SATELLITE_3D_MAP]});
            this.map.setCenter(new google.maps.LatLng(46.73986, 2.17529), 5, G_PHYSICAL_MAP);
            // Custom controls should be created first for stock controls to appear in front of them
            this._createTitleControl('VisuGps');
            this.map.addControl(this.titleCtrl);
            // Add built-in controls            
            this.map.addControl(new google.maps.LargeMapControl3D());
            this.map.addControl(new google.maps.ScaleControl());
            this.map.enableScrollWheelZoom();
            this.map.disableDoubleClickZoom();
            // Add extra layers
            var copyright = new GCopyrightCollection("\u00a9 ");
            copyright.addCopyright(new GCopyright("XContest", new GLatLngBounds(new GLatLng(-90, -180), new GLatLng(90, 180)), 0, "\u00a9 XContest"));
            var tileLayer = new GTileLayer(copyright);
            tileLayer.getTileUrl = function(tile, zoom) { return "http://maps.pgweb.cz/airspace/" + zoom + "/" + tile.x + "/" + tile.y; };
            tileLayer.isPng = function() { return true; }
            tileLayer.getOpacity = function() { return 0.9; }
            airspaces = new GTileLayerOverlay(tileLayer);

            tileLayer = new GTileLayer(copyright);
            tileLayer.getTileUrl = function(tile, zoom) { return "http://maps.pgweb.cz/corr/" + zoom + "/" + tile.x + "/" + tile.y; };
            tileLayer.isPng = function() { return true; }
            tileLayer.getOpacity = function() { return 0.9; }
            skyways = new GTileLayerOverlay(tileLayer);            
            var more = new MoreControl(
            [
              { name: "Photos", obj: new GLayer("com.panoramio.all") },
              { name: "Webcams", obj: new GLayer("com.google.webcams")},
              { name: "AirSpace", obj: airspaces},
              { name: "Sky ways", obj: skyways}              
            ]);
            this.map.addControl(more);
            // Handle the route
            if (route != undefined && route.flightType && route.turnpoints) {
              this.route = route;
              this.drawRoute();
            }
        }
    },
    /*
    Property: clean
            Class destructor. Help release the memory.
    */
    clean : function() {
        google.maps.Unload();
        frames.ign.destroy();
        if (this.charts) this.charts.clean();
        window.removeEvents('resize');
    },
    /*
    Property: setTrack
            Set the track to be displayed.

    Arguments:
            track - an object representing the track. See Track below.

    Track:
            lat - Array of latitude (degre)
            lon - Array of longitude (degre)
            elev - Array of track elevation (meter)
            elevGnd - Array of ground elevation (meter)
            speed - Array of speed (km/h)
            vario - Array of climbing rate (m/s)
            time - Array of time (for x Axis labeling)
            nbPt - Number of points in lat, lon arrays.
            nbLbl - Number of label in time array
            date - Object representing the flight date
    */
    setTrack : function(track) {
        this.track = track;
        var opt = this.options;
        var load = $(opt.loadDiv);
        
        if (track.error != null) {
            if (load) {
                load.set('html', track.error);
                new Fx.Morph(load, {transition: Fx.Transitions.linear})
                  .start({
                    'duration' : 500,
                    'opacity': 0.9,
                    'background-color': '#ff2222'
                  });
            }
            return;
        }

        if (track.kmlUrl != null) {
            // Display KML files (no graph available)
            var me = this;

            var kml = new google.maps.GeoXml(track.kmlUrl,
                                             function() {
                                                 if (kml.loadedCorrectly()) {
                                                     kml.gotoDefaultViewport(me.map);
                                                     me.map.addOverlay(kml);
                                                     // Remove the top most overlay from the map
                                                     if (load) {
                                                         load.fade('out');
                                                     }
                                                     // Print a warning for limited support
                                                     new Element('p', {
                                                       'style' : 'text-align:center;margin:20px;font:10px Verdana, Arial, sans-serif'
                                                     }).inject($(me.options.chartDiv), 'top');
                                                 }
                                             });
        } else {
            // Full track information available
            this._createInfoControl();
            this.map.addControl(this.infoCtrl);
            this.nfo = $('vgps-nfofield');

            var bounds = new google.maps.LatLngBounds();

            var point = {};
            for (var i = 0; i < this.track.nbTrackPt; i++) {
                point = new google.maps.LatLng(this.track.lat[i], this.track.lon[i]);
                this.points.push(point);
                bounds.extend(point);
            }

            // Clamp values
            var maxSpeed = opt.maxSpeed;
            var maxVario = opt.maxVario;
            var minVario = -maxVario;
            var maxElev = opt.maxElev;
            for (i = this.track.nbChartPt - 1; i >= 0; i--) {
                this.track.speed[i] = this.track.speed[i].limit(0, maxSpeed);
                this.track.vario[i] = this.track.vario[i].limit(minVario, maxVario);
                this.track.elev[i] = this.track.elev[i].limit(0, maxElev);
            }

            // Center the map on the track
            this.map.setCenter(bounds.getCenter(), this.map.getBoundsZoomLevel(bounds));
            this._displayTrack();

            // Put the marker on the take-off place
            this.marker = new google.maps.Marker(this.points[0], {clickable:false});
            this._showMarker(0);
            this.map.addOverlay(this.marker);

            // Add event handlers
            google.maps.Event.addListener(this.map, 'moveend', this._displayTrack.bind(this));
            google.maps.Event.addListener(this.map, 'maptypechanged', this._mapTypeChanged.bind(this));
            window.addEvent('resize', this._resize.bind(this));

            this.mapTitle = [this.track.date.day, this.track.date.month, this.track.date.year].join('/');

            if ((this.mapTitle !== '0/0/0') &&
                (typeOf(opt.weatherTileUrl) === 'array')) {
                this._createModisMap(this.track.date.day, this.track.date.month, this.track.date.year);
            }

            if (this.track.pilot) this.mapTitle += '<br/>' + this.track.pilot;
            this.titleCtrl.setText(this.mapTitle);

            if (typeOf(opt.elevTileUrl) === 'array') {
                this._createSrtmMap();
            }

            // Increase info window size to fit the anim control
            var h = $('vgps-anim').getParent().getCoordinates().height +
                    $('vgps-anim').getCoordinates().height;

            $('vgps-anim').getParent().setStyle('height', h);

            this._initGraph();
            
            // Remove the top most overlay from the map
            if (load) {
                load.fade('out');
            }
        }

        if (opt.showIgnMap) {
            document.getElementById('ign').src = './ign.html';
        }

        // Add common event handlers
        google.maps.Event.addListener(this.map, 'click', this._leftClick.bind(this));
        if (opt.measure) {
            google.maps.Event.addListener(this.map, 'singlerightclick', this._rightClick.bind(this));
        }

        // Add map type selector
        this.map.addControl(new google.maps.MenuMapTypeControl());
        
    },

    drawRoute: function() {
      var map = this.map,
          pos,
          icon,
          startIcon, endIcon,
          start, end, tp, tps = [],
          ovs = [],
          bounds = new google.maps.LatLngBounds();

      icon = new google.maps.Icon(G_DEFAULT_ICON);
      icon.image = "http://labs.google.com/ridefinder/images/mm_20_orange.png";
      icon.shadow = "http://labs.google.com/ridefinder/images/mm_20_shadow.png";
      icon.iconSize = new google.maps.Size(12, 20);
      icon.shadowSize = new google.maps.Size(22, 20);
      icon.iconAnchor = new google.maps.Point(6, 20);

      startIcon = new google.maps.Icon(icon);
      startIcon.image = "http://labs.google.com/ridefinder/images/mm_20_green.png";

      endIcon = new google.maps.Icon(startIcon);
      endIcon.image = "http://labs.google.com/ridefinder/images/mm_20_red.png";

      Array.each(JSON.decode(this.route.turnpoints) || [], function(pos) {
          tp = new google.maps.LatLng(pos[0], pos[1]);
          tps.push(tp);
          bounds.extend(tp);
      });
     
      ovs.push(new GPolyline(tps, "#00f", 1, 0.9));

      if (this.route.flightType && this.route.flightType.substr(-1) === 'c' ) {
        if (pos = JSON.decode(this.route.start)) {
            start = new google.maps.LatLng(pos[0], pos[1]);
            ovs.push(new google.maps.Marker(start, { clickable: false, icon: startIcon } ));
            ovs.push(new GPolyline([start, tps[0]], "#222", 1, 0.9));
            bounds.extend(start);
        }
        if (pos = JSON.decode(this.route.end)) {
            end = new google.maps.LatLng(pos[0], pos[1]);
            ovs.push(new google.maps.Marker(end, { clickable: false, icon: endIcon  } ));
            ovs.push(new GPolyline([end, tps[tps.length - 1]], "#222", 1, 0.9));
            bounds.extend(end);
        }
        ovs.push(new GPolyline([tps[0], tps[tps.length - 1]], "#00f", 1, 0.9));
      } else {
        ovs.push(new google.maps.Marker(tps.shift(), { clickable: false, icon: startIcon}));
        ovs.push(new google.maps.Marker(tps.pop(), { clickable: false, icon: endIcon}));
      }

      Array.each(tps, function(tp) { ovs.push(new google.maps.Marker(tp, {clickable: false, icon: icon})); });
      Array.each(ovs, function(ov) { map.addOverlay(ov); });

      this.map.setCenter(bounds.getCenter(), this.map.getBoundsZoomLevel(bounds));

      if ($(this.options.loadDiv)) { $(this.options.loadDiv).fade(); }
    },

    /*
    Property: initIgnMap
            Initialize IGN map
    */
    initIgnMap : function() {
        this.ignMap = frames.ign;
        if (this.track.kmlUrl != null) {
            this.ignMap.setTrackKml('php/vg_directproxy.php?url=', this.track.kmlUrl);
        } else {
            this.ignMap.setTrack(this.track.lat, this.track.lon);
        }
        // Add the map switcher control
        this.mapSwitcher = new Element('div', {'id' : 'vgps-mapSwitcher'}).inject(this.options.chartDiv, 'top');
        this.mapSwitcher.set('html', '<b>google</b> / ign');
        this.mapSwitcher.addEvent('mousedown', this._switchMap.bind(this));
        // Add the route layer
        if (this.route) { this.ignMap.setRoute(
            this.route.flightType,
            this.route.turnpoints && JSON.decode(this.route.turnpoints),
            this.route.start && JSON.decode(this.route.start),
            this.route.end && JSON.decode(this.route.end)
        );}
    },
    /*
    Property: ignLeftClick
            Called when a left click occurs on IGN map
    */
    ignLeftClick : function(lat, lon) {
        this._leftClick(null, new google.maps.LatLng(lat, lon));
    },
    /*
    Property: _switchMap
            Switch between IGN anf Google maps
    */
    _switchMap : function(event) {
        event.stopPropagation().preventDefault();
        if (this.mapType == 'google') {
            $('ignwrap').setStyle('left', 0);
            $(this.options.mapDiv).setStyle('left', -5000);
            this.mapSwitcher.set('html', 'google / <b>ign</b>');
            this.mapType = 'ign';
            this._resize();            
        } else {
            $('ignwrap').setStyle('left', -5000);
            $(this.options.mapDiv).setStyle('left', 0);
            this.mapType = 'google';
            this.mapSwitcher.set('html', '<b>google</b> / ign');
        }        
    },
    /*
    Property: _gePluginInit (INTERNAL)
            Initialize GE plugin (add 3D track)

    Arguments:
            ge - GEPlugin object

    
    */
    _gePluginInit : function(ge) {
        if (this.track.kmlUrl == null) {
            this.ge = ge;
            // Create the 3d track
            var lineString;
            lineString = ge.createLineString('');
            var lineStringPlacemark = ge.createPlacemark('');
            lineStringPlacemark.setGeometry(lineString);
            lineString.setTessellate(false);
            var text = '';
            for (var i = 0; i < this.track.nbTrackPt; i ++) {
                lineString.getCoordinates().pushLatLngAlt(this.track.lat[i],
                                                          this.track.lon[i],
                                                          this._getTrackElevation(i));
            }
            ge.getFeatures().appendChild(lineStringPlacemark);
            lineString.setAltitudeMode(ge.ALTITUDE_ABSOLUTE);
            
            google.earth.addEventListener(ge.getWindow(), "mousedown", this._leftClick3d.bind(this));

            if (!lineStringPlacemark.getStyleSelector()) {
                lineStringPlacemark.setStyleSelector(ge.createStyle(''));
            }
            var lineStyle = lineStringPlacemark.getStyleSelector().getLineStyle();
            lineStyle.setWidth(1);
            lineStyle.getColor().set('ff0000ff');
            // Create the 3d marker
            var placemark = ge.createPlacemark('Pilot');
            ge.getFeatures().appendChild(placemark);
            this.model3d = ge.createModel('');
            var link = ge.createLink('');
            link.setHref('http://victorb.fr/visugps/img/paraglider.dae');
            this.model3d.setLink(link);
            placemark.setGeometry(this.model3d);
            this.marker3d = ge.createLocation('');
            this.model3d.setLocation(this.marker3d);
            this.orientation = ge.createOrientation('');
            this.model3d.setOrientation(this.orientation);
            var scale = ge.createScale('');
            scale.set(50, 50, 50);
            this.model3d.setScale(scale);
            this.model3d.setAltitudeMode(ge.ALTITUDE_ABSOLUTE);
            this._set3dPosition(0);
        }
    },
    /*
    Property: _set3dPosition (INTERNAL)
            - Move the 3d marker on the track

    Arguments:
            index: 3d marker position (0 ... NbTrackPoint)
    */
    _set3dPosition : function(index) {
        // Set the marker position
        this.marker3d.setLatLngAlt(this.track.lat[index],
                                   this.track.lon[index],
                                   this._getTrackElevation(index));
        // Set the marker heading
        var i = index + 1;
        if (i >= this.track.nbTrackPt) j = this.track.nbTrackPt - 1;
        var angle;
        var deltaLat = this.track.lat[i] - this.track.lat[index];
        var deltaLon = this.track.lon[i] - this.track.lon[index];
        if (deltaLon == 0) {
          angle = deltaLat > 0?Math.PI / 2: 3 * Math.PI / 2;
        } else {
          angle = Math.atan(deltaLat / deltaLon);
          if (deltaLon < 0) {
              angle = Math.PI + angle;
          }
        }
        // Convert angle (radian) to heading (degree, 0deg = North)
        angle = angle * 180 / Math.PI;
        angle = 90 - angle;
        // Apply model origin (255deg)
        angle = angle + 255;
        if (angle < 0) angle += 360;
        if (angle > 360) angle -= 360;
        this.orientation.setHeading(angle);
    },

    /*
    Property: _leftClick3d (INTERNAL)
            - Move the marker to the track point closest to the mouse click

    Arguments:
            kmlEvent: Event description
    */
    _leftClick3d : function(kmlEvent) {
        var point = new google.maps.LatLng(kmlEvent.getLatitude(), kmlEvent.getLongitude());
        this._leftClick(null, point);
    },
     /*
    Property: _mapTypeChanged (INTERNAL)
            Trigerred when map type is changed.
            2D track is removed when switching to GE plugin.
    */
    _mapTypeChanged : function() {
        if (this.map.getCurrentMapType() == G_SATELLITE_3D_MAP) {
            if (this.path) {
                this.map.removeOverlay(this.path);
            // Init the 3d map when displayed for the first time
            if (this.init3dMap) {
                this.map.getEarthInstance(this._gePluginInit.bind(this));
                this.init3dMap = false;
            }
            // Create iframe shims to view custom controls
            new IFrame({src: 'javascript:false',
                        'frameborder': 0,
                        'scrolling': 'no',
                        styles: {
                            width: '100%',
                            height: '100%',
                            border: '0',
                            position: 'absolute',
                            font: '1px',
                            top: 0,
                            left: 0,
                            zIndex: -10000
                        }}).inject(this.titleCtrl.div);
            new IFrame({src: 'javascript:false',
                        'frameborder': 0,
                        'scrolling': 'no',
                        styles: {
                            width: '100%',
                            height: '100%',
                            border: '0',
                            position: 'absolute',
                            font: '1px',
                            top: 0,
                            left: 0,
                            zIndex: -10000
                        }}).inject(this.infoCtrl.div);
            this.iFrameShim = true;
            }
        } else {
            if (this.iFrameShim) {
                this.titleCtrl.div.getFirst('iframe').dispose();
                this.infoCtrl.div.getFirst('iframe').dispose();
                this.iFrameShim = false;
            }
            this._displayTrack();
        }
    },
     /*
    Property: _getTrackElevation (INTERNAL)
            Return interpolated elevation (elevation data are less accurate than position data)
            
    Arguments:
            index: index (0 ... nbTrackPt - 1)
            
    Returns:
            interpolated track elevation
    */
    _getTrackElevation : function(index) {
        index = index * (this.track.nbChartPt - 1) / (this.track.nbTrackPt - 1);
        var i = index.round();
        var j = i + 1;
        if (j >= this.track.nbChartPt) j = this.track.nbChartPt - 1;
        return this.track.elev[i] + (index - i) * (this.track.elev[j] - this.track.elev[i]);
    },
    /*
    Property: downloadTrack
            Load a track at the given URL.

    Arguments:
            url - URL of the track (JSON format)

    See:
            setTrack method.
    */
    downloadTrack : function(url) {
        new Request.JSON({
          'url' : 'php/vg_proxy.php?track=' + url,
          onSuccess: this.setTrack.bind(this), 
          method: 'get'}
        ).send();
    },
    /*
    Property: toggleAnim (INTERNAL)
            Toggle (start/stop) the animation
    */
    _toggleAnim : function(e) {
        if (e.rightClick) {
            this.animPos = 0;
            clearInterval(this.animTimer);
            this.animTimer = null;
            var playGif = $('vgps-anim').getStyle('background-image').replace(/pause/, 'play');
            $('vgps-anim').setStyle('background-image', playGif);
            this._animate();
        } else {
            if (this.animTimer === null) {
                this.animTimer = this._animate.periodical(this.animDelay.val, this);
                this.charts.showCursor(true);
                var pauseGif = $('vgps-anim').getStyle('background-image').replace(/play/, 'pause');
                $('vgps-anim').setStyle('background-image', pauseGif);
            } else {
                clearInterval(this.animTimer);
                this.animTimer = null;
                var playGif = $('vgps-anim').getStyle('background-image').replace(/pause/, 'play');
                $('vgps-anim').setStyle('background-image', playGif);
            }
        }
    },
    /*
    Property: _setAnimDelay (INTERNAL)
            Set animation speed

    Arguments:
            val: 0 = min ... 100 = max
    */
    _setAnimDelay : function(val) {
        this.animDelay.val = this.animDelay.min +
                             (100 - val) / 100 * (this.animDelay.max - this.animDelay.min);
        if (this.animTimer !== null) {
            clearInterval(this.animTimer);
            this.animTimer = this._animate.periodical(this.animDelay.val, this);
        }
    },
    /*
    Property: _animate (INTERNAL)
            Animation the marker
    */
    _animate : function() {
        if (this.animPos >= 1000) {
            this.animPos = 0;
            clearInterval(this.animTimer);
            this.animTimer = null;
            var playGif = $('vgps-anim').getStyle('background-image').replace(/pause/, 'play');
            $('vgps-anim').setStyle('background-image', playGif);
        } else {
            this._showMarker(this.animPos);
            this.charts.setCursor(this.animPos++);
            if (!this.map.getBounds().contains(this.marker.getPoint())) {
                this.map.setCenter(this.marker.getPoint());
            }
        }
    },
    /*
    Property: _rightclick (INTERNAL)
            Handle right click to measure distance on the map
            
    Arguments:
            points: coordinate (px) of the clicked point.
            
    Right clicks:
        1: Set starting point - start displaying distance from it
        2: Set ending point - display start - end distance
        3: Return to normal state (no more distance measurment)
    */
    _rightClick : function(point) {
        this.distState++;
        switch (this.distState) {
            case 1:
                // 1st click: start measurment
                var ptll = this.map.fromContainerPixelToLatLng(point);
                this.distPts = [ptll];
                this.distLine = null;
                google.maps.Event.addListener(this.map, 'mousemove', this._mouseMove.bind(this));
                this._mouseMove(ptll);
                break;
            case 2:
                // 2nd click: stop measurment
                google.maps.Event.clearListeners(this.map, 'mousemove');
                break;
            case 3:
                // 3rd click: remove the distance line
                if (this.distLine) this.map.removeOverlay(this.distLine);
                this.titleCtrl.setText(this.mapTitle);
            default:
                this.distState = 0;
        }
    },
    /*
    Property: _mousemove (INTERNAL)
            Draw the distance line and display the distance when required

    Arguments:
            points: coordinate (lat, lng) of the point.
    */
    _mouseMove : function(point) {
        var dPts = this.distPts.concat([point]);
        if (this.distLine) {
            this.map.removeOverlay(this.distLine);
            this.distLine = null;
        }
        this.distLine = new google.maps.Polyline(dPts, '#ffff00', 4, 0.6, {'clickable' : false});
        this.map.addOverlay(this.distLine);
        var dist = this.distLine.getLength();
        var legend;
        if (dist < 1000) {
            legend = dist.round(2) + ' m';
        } else {
            legend = (dist / 1000).round(2) + ' km';
        }

        if (this.options.measureCfd) {
          var type = null;
          var coef = 1.2;
          switch (dPts.length) {
            case 2:
                type = 'DL';
                coef = 1;
                break;
            case 3:
                if (dPts[0].distanceFrom(dPts[2]) < 3000) {
                    type = 'AR'
                } else {
                    type = 'DL1';
                    coef = 1;
                }
                break;
            case 4:
                if (dPts[0].distanceFrom(dPts[3]) < 3000) {
                    var fai = true;
                    for (var idx = 0; idx < 3; idx ++) {
                        if (dPts[idx].distanceFrom(dPts[idx + 1]) < 0.28 * dist) {
                            fai = false;
                            break;
                        }
                    }
                    type = fai?'FAI':'TR';
                    coef = fai?1.4:1.2;
                } else {
                    type = 'DL2';
                    coef = 1;
                }
                break;
            case 5:
                if (dPts[0].distanceFrom(dPts[4]) < 3000) {
                    type = 'QD';
                }
                break;
            default:
          }
          if (type !== null) {
              legend += '<br/>' + type + ' ' + (coef * dist / 1000).round(2) + ' pts';
          }
        }

        this.titleCtrl.setText(legend);
    },
    /*
    Property: _leftClick (INTERNAL)
            - Move the marker to the track point closest to the mouse click or
            - Add an intermediate point while measuring distance

    Arguments:
            marker: unused.
            point: Mouse click location (lat/lng)
    */
    _leftClick : function(marker, point) {
        if (point === null) return;
        switch (this.distState) {
            case 1:
                // Add an intermediate point (in measurment mode)
                this.distPts.push(point);
                this._mouseMove(point);
                break;
            default:
                // Center on the closest point (not in measurment mode)
                if (this.points.length) {
                    var bestIdx = 0;
                    var bestDst = this.points[0].distanceFrom(point);
                    var dst;
                    for (var i = this.points.length - 1; i >= 0; i--) {
                        dst = this.points[i].distanceFrom(point);
                        if (dst < bestDst) {
                            bestIdx = i;
                            bestDst = dst;
                        }
                    }
                    this.marker.setPoint(this.points[bestIdx]);
                    if (this.marker3d) {
                        this._set3dPosition(bestIdx);
                    }
                    if (this.ignMap != null) {
                        this.ignMap.setMarker(this.track.lat[bestIdx], this.track.lon[bestIdx]);
                    }
                    var pos = (1000 * bestIdx / this.track.nbTrackPt).toInt();
                    this.charts.setCursor(pos);
                    this._showInfo(pos);
                }
        }
    },
    /*
    Property: _initGraph (INTERNAL)
            Display series on the graph
    */
    _initGraph : function() {
        this.charts = new Charts($(this.options.chartDiv),
                                 {onMouseMove : this._showMarker.bind(this),
                                  onMouseDown : this._showMarkerCenter.bind(this),
                                  onMouseWheel : this._showMarkerCenterZoom.bind(this)});

        var chart = this.charts.add('h', 0.9, '#ff0000');
        chart.setGridDensity(this.track.nbChartLbl, 4);
        chart.setHorizontalLabels(this.track.time.label);
        chart.add('hV', '#ff0000', this.track.elev, CHART_LINE);
        chart.add('hS', '#755545', this.track.elevGnd, CHART_AREA);

        chart = this.charts.add('Vx', 0.2, '#00ff00');
        chart.setGridDensity(this.track.nbChartLbl, 4);
        chart.setHorizontalLabels(this.track.time.label);
        chart.add('Vx', '#00ff00', this.track.speed, CHART_LINE);

        chart = this.charts.add('Vz', 0.2, '#0000ff');
        chart.setLabelPrecision(1);
        chart.setGridDensity(this.track.nbChartLbl, 4);
        chart.setHorizontalLabels(this.track.time.label);
        chart.add('Vz', '#0000ff', this.track.vario, CHART_LINE);

        this._drawGraph();
    },
    /*
    Property: _resize (INTERNAL)
            Trigger graph redraw 100ms after the window has been resized.
            This is required for IE which keep sending resize events while the
            window is being resized.
    */
    _resize : function() {
        if (this.charts) this.charts.showCursor(false);
        if (this.timer) clearTimeout(this.timer);
        this.timer = this._drawGraph.delay(100, this);        
        if (this.ignMap != null) {
            var size = $('ignwrap').getSize();
            this.ignMap.reSize(size.x, size.y);
        }
    },
    /*
    Property: _drawGraph (INTERNAL)
            Draw the graph.
    */
    _drawGraph : function () {
        if (this.points.length < 5) return;
        this.charts.draw();
    },
    /*
    Property: _displayTrack (INTERNAL)
            Display the track.
    */
    _displayTrack : function() {
        if (this.points.length < 5 || this.map.getCurrentMapType() == G_SATELLITE_3D_MAP) return;
        var path = new google.maps.Polyline(this._getReducedTrack(), "#ff0000", 1, 1, {'clickable' : false});
        // Remove the click listener from existing track
        if (this.path) {
            this.map.removeOverlay(this.path);
        }
        this.map.addOverlay(this.path = path);
    },
    /*
    Property: _getReducedTrack (INTERNAL)
            Reduce the track point count by removing unvisible points (out of view area)
            and points that overlap.
    Return:
            The shortened track.
    */
    _getReducedTrack : function() {
        var Sw = this.map.getBounds().getSouthWest();
        var Ne = this.map.getBounds().getNorthEast();
        var deltaLat = Ne.lat() - Sw.lat();
        var deltaLng = Ne.lng() - Sw.lng();

        // Keep only points that are in the view area and close neighbourhood
        var bufSw = new google.maps.LatLng(Sw.lat() - deltaLat, Sw.lng() - deltaLng);
        var bufNe = new google.maps.LatLng(Ne.lat() + deltaLat, Ne.lng() + deltaLng);
        var scrollBuffer = new google.maps.LatLngBounds(bufSw, bufNe);

        // Flush points that are too close from each other
        var minStepLat = 3 * deltaLat / this.map.getSize().width;
        var minStepLng = 3 * deltaLng / this.map.getSize().height;

        var lastLat = this.points[0].lat();
        var lastLng = this.points[0].lng();
        var shortTrack = [];
        var point= {};
        shortTrack.push(this.points[this.points.length - 1]);

        for (var i = this.points.length - 1; i >= 0; i--) {
            point = this.points[i];
            if (scrollBuffer.contains(point) &&
               (((point.lat() - lastLat).abs() > minStepLat) ||
                ((point.lng() - lastLng).abs() > minStepLng))) {
                shortTrack.unshift(point);
                lastLat = point.lat();
                lastLng = point.lng();
            }
        }

        return shortTrack;
    },
    /*
    Property: _showMarker (INTERNAL)
            Move the marker and eventually center the map above the marker

    Arguments:
            pos - Marker location (0...1000)
            center - true to centre the map
    */
    _showMarker : function(pos, center) {
        center = center == undefined ? false : center;
        var idx = (pos * (this.track.nbTrackPt - 1) / 1000).toInt();
        this.marker.setPoint(this.points[idx]);
        if (this.marker3d) {
            this._set3dPosition(idx);
        }
        if (this.map.getCurrentMapType() == G_SATELLITE_3D_MAP) {
            if (center || (this.animTimer != null)) {
                var lookAt = this.ge.getView().copyAsLookAt(this.ge.ALTITUDE_ABSOLUTE);
                lookAt.setLatitude(this.track.lat[idx]);
                lookAt.setLongitude(this.track.lon[idx]);
                this.ge.getView().setAbstractView(lookAt);
            }
        } else {
            if (center) {
                this.map.panTo(this.points[idx]);
            }
        }
        if (this.ignMap != null) {
            this.ignMap.setMarker(this.track.lat[idx], this.track.lon[idx]);
            if (center) {
                this.ignMap.setCenter(this.track.lat[idx], this.track.lon[idx]);
            }
        }
        this._showInfo(pos);
        if (this.map.getCurrentMapType() == G_SATELLITE_3D_MAP) {
            this.marker.hide();
        } else {
            this.marker.show();
        }
    },
    /*
    Property: _showMarkerCenter (INTERNAL)
            Move the marker and center the map above the marker

    Arguments:
            pos - Marker location (GPoint object)
    */
    _showMarkerCenter : function(pos) {
        this._showMarker(pos, true);
    },
    /*
    Property: _showMarkerCenterZoom (INTERNAL)
            Move the marker, center the map above the marker and zoom

    Arguments:
            pos - Marker location (GPoint object)
            wheel - Mouse wheel direction
    */
    _showMarkerCenterZoom : function(pos, wheel) {
        if (wheel > 0) {
            this.map.zoomIn();
            if (this.ignMap != null) {this.ignMap.zoom('in');}
        } else {
            this.map.zoomOut();
            if (this.ignMap != null) {this.ignMap.zoom('out');}
        }
        this._showMarker(pos, true);
    },
    /*
    Property: _showInfo (INTERNAL)
            Update the info control with the point information

    Arguments:
            pos - point location (0...1000)
    */
    _showInfo : function(pos) {
        var idx = (pos * (this.track.nbChartPt - 1) / 1000).toInt();
        this.nfo.set('html',this.track.elev[idx] + 'm [hV]<br/>' +
                            this.track.elevGnd[idx] + 'm [hS]<br/>' +
                            (0).max((this.track.elev[idx] - this.track.elevGnd[idx])) + 'm [hR]<br/>' +
                            this.track.vario[idx] + 'm/s [Vz]<br/>' +
                            this.track.speed[idx] + 'km/h [Vx]<br/>' +
                            this._NbToStrW(this.track.time.hour[idx],2) + ':' +
                            this._NbToStrW(this.track.time.min[idx], 2) + ':' +
                            this._NbToStrW(this.track.time.sec[idx], 2) + '[Th]<br/>' +
                            'by suumit.com');
                          
        if (this.ignMap) this.ignMap.setInfo(this.nfo.get('html'));
    },
    /*
    Property: _createTitleControl (INTERNAL)
            Create the title control to display the date and pilot name.

    Note:   The control is not added to the map by this function.

    Arguments:
            title: Text displayed by the title control (changed with setText)
    */
    _createTitleControl : function(title) {
        function TitleControl(title) {
            this.div = null;
            this.title = title;
        }
        TitleControl.prototype = new google.maps.Control();

        TitleControl.prototype.initialize = function(map) {
            this.div = new Element('div', {'styles' : {'color': '#000',
                                                       'border': '1px inset #555555',
                                                       'padding': '2px',
                                                       'font':'10px Verdana, Arial, sans-serif',
                                                       'marginBottom':'3px',
                                                       'background':'#FFFFCC',
                                                       'text-align':'right'}
                                  }).set('html', this.title)
                                    .inject(map.getContainer());
            return this.div;
        }

        TitleControl.prototype.getDefaultPosition = function() {
            return new google.maps.ControlPosition(G_ANCHOR_TOP_RIGHT, new GSize(7, 30));
        }

        TitleControl.prototype.setText = function(title) {
            this.title = title;
            this.div.set('html', title);
        }

        this.titleCtrl = new TitleControl(title);
    },
    /*
    Property: _createInfoControl (INTERNAL)
            Create the info control to display track information.

    Note:   The control is not added to the map by this function
    */
    _createInfoControl : function() {
        function InfoControl() {
            this.div = null;
        }
        var me = this;

        InfoControl.prototype = new google.maps.Control();

        InfoControl.prototype.selectable = function(){return false;}
        InfoControl.prototype.initialize = function(map) {
            this.div = new Element('div', {'styles' : {'border': '1px inset #555555',
                                                       'padding': '2px',
                                                       'margin':'1px',
                                                       'background':'#FFFFCC',
                                                       'text-align':'right',
                                                       'font' : '10px Verdana, Arial, sans-serif'}
                                 }).set('html', '<p class="vgps-info"><strong>...iNfO</strong></p>' +
                                                '<p class="vgps-info" id="vgps-nfofield"></p>' +
                                                '<div id="vgps-anim"><div id="vgps-play"></div></div>' +
                                                '</div>')
                                   .inject(map.getContainer());



            // Add the animation control
            $('vgps-play').addEvent('mousedown', function(event) {(new Event(event)).stop();});
            $('vgps-anim').addEvent('mousedown', me._toggleAnim.bind(me));
            new SliderProgress('vgps-play', {'color': '#FF850C',
                                             'onChange' : me._setAnimDelay.bind(me)}).set(50);


            return this.div;
        }

        InfoControl.prototype.getDefaultPosition = function() {
            return new google.maps.ControlPosition(G_ANCHOR_BOTTOM_RIGHT, new GSize(2, 12));
        }

        this.infoCtrl = new InfoControl();
    },
    /*
    Property: _createSrtmMap (INTERNAL)
            Create the SRTM (elevation) map
    */
    _createSrtmMap : function() {
        // SRTM custom map
        var srtmCpy = new google.maps.Copyright(1, new google.maps.LatLngBounds(new google.maps.LatLng(-90, -180),
                                                                                new google.maps.LatLng(90, 180)),
                                                                                0, "SRTM");

        var srtmCpyC = new google.maps.CopyrightCollection();
        srtmCpyC.addCopyright(srtmCpy);

        var url = this.options.elevTileUrl;
        url.map(function(item, idx) {
            return item.replace(/\/$/, '');
        });

        var srtmTL = [new google.maps.TileLayer(srtmCpyC, 0, 16)];
        srtmTL[0].getTileUrl = function(point, zoom){
                var count = url.length;
                var n = (point.x + point.y) % count;
                return 'http://' + url[n] + '/vg_tilesrtm.php?x=' + point.x + '&y=' + point.y + '&z=' + zoom;
            }
        var srtmMap = new google.maps.MapType(srtmTL, new google.maps.MercatorProjection(18), 'Elevation');

        this.map.addMapType(srtmMap);
    },
    /*
    Property: _createModisMap (INTERNAL)
            Create the MODIS (weather) map

    Arguments:
            day, month, year - date of the map

    */
    _createModisMap : function(day, month, year) {
          // Modis pictures use a flat projection
          function EuclideanProjection(){}

          EuclideanProjection.prototype=new google.maps.Projection();

          EuclideanProjection.prototype.fromLatLngToPixel=function(point, zoom){
            var size = (2).pow(zoom) * 256;
            var x = (point.lng() + 180) * size /360;
            var y = (90 - point.lat()) * size / 180;
            return new google.maps.Point(x.round(), y.round());
          }

          EuclideanProjection.prototype.fromPixelToLatLng=function(point, zoom, unbounded){
            var size = (2).pow(zoom) * 256;
            var lng = point.x * 360 / size - 180;
            var lat = 90 - (point.y * 180 / size);
            return new GLatLng(lat, lng, unbounded);
          }

          EuclideanProjection.prototype.tileCheckRange=function(tile, zoom, unbounded){
              var size = (2).pow(zoom);
              if (tile.y < 0 || tile.y >= size) return false;
              if (tile.x < 0 || tile.x >= size) {
                  tile.x %= size;
                  if (tile.x < 0) tile.x += size;
              }
              return true;
          }

          EuclideanProjection.prototype.getWrapWidth=function(zoom) {
              return (2).pow(zoom) * 256;
          }

          function getDayNumber(day, month, year) {
              var now = new Date;
              now.setUTCFullYear(year, month - 1, day);
              var ny = new Date;
              ny.setUTCFullYear(year, 0, 1);
              return (now - ny) / (1000 * 3600 * 24) + 1;
          }

          var dayNum = this._NbToStrW(getDayNumber(day, month, year), 3);
          var date = year.toString() + dayNum;

          // MODIS custom map
          var modisCpy = new google.maps.Copyright(1, new google.maps.LatLngBounds(new google.maps.LatLng(-90, -180),
                                                                                   new google.maps.LatLng(90, 180)),
                                                                                   0, "MODIS");

          var modisCpyC = new google.maps.CopyrightCollection();
          modisCpyC.addCopyright(modisCpy);

          var url = this.options.weatherTileUrl;
          url.map(function(item, idx) {
              return item.replace(/\/$/, '');
          });

          var modisTL = [new google.maps.TileLayer(modisCpyC, 0, 9)];
          modisTL[0].getTileUrl = function(point, zoom){
                var count = url.length;
                var n = (point.x + point.y) % count;
                return 'http://' + url[n] + '/vg_tilemodis.php?x=' + point.x + '&y=' + point.y + '&z=' + zoom + '&date=' + date;
              }
          var modisMap = new google.maps.MapType(modisTL, new EuclideanProjection(18), "Weather");
          this.map.addMapType(modisMap);
    },
    /*
    Property: _NbToStrW (INTERNAL)
            Return the string representation of a number (left padded with 0 to w width)

    Arguments:
            nb - number
            w - width (left padded with 0).

    Return:
            Number as string left padded with 0 to the requested width

    */
    _NbToStrW : function(nb, w) {
        var nbs = nb.toString();
        while (nbs.length < w) nbs = '0' + nbs;
        return nbs;
    }

});
