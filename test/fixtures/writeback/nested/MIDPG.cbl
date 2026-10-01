       IDENTIFICATION DIVISION.
       PROGRAM-ID. MIDPG.
       DATA DIVISION.
       LINKAGE SECTION.
       01 LK-A               PIC X(40).
       01 LK-B               PIC X(40).
       PROCEDURE DIVISION USING LK-A LK-B.
           CALL 'LEAFPG' USING LK-A LK-B
           GOBACK.
