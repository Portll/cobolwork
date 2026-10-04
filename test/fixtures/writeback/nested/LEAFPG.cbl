       IDENTIFICATION DIVISION.
       PROGRAM-ID. LEAFPG.
       DATA DIVISION.
       LINKAGE SECTION.
       01 LK-C               PIC X(40).
       01 LK-D               PIC X(40).
       PROCEDURE DIVISION USING LK-C LK-D.
           MOVE LK-C TO LK-D
           GOBACK.
