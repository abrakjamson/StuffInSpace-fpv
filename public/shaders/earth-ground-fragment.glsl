uniform float fNightScale;
uniform vec3 v3LightPosition;
uniform sampler2D tDiffuse;
uniform sampler2D tDiffuseNight;
varying vec3 c0;
varying vec3 c1;
varying vec3 vNormal;
varying vec2 vUv;
void main (void)
{
    vec3 diffuseTex = texture2D( tDiffuse, vUv ).xyz;
    vec3 diffuseNightTex = texture2D( tDiffuseNight, vUv ).xyz;
    float sunlight = clamp(dot(normalize(vNormal), normalize(v3LightPosition)), -1.0, 1.0);
    float terminator = smoothstep(-0.08, 0.18, sunlight);
    vec3 day = diffuseTex * (0.18 + 0.92 * terminator);
    vec3 night = fNightScale * diffuseNightTex * (1.0 - terminator);
    gl_FragColor = vec4(c1 + day + night, 1.0);
}